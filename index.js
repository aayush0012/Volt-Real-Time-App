"use strict";

const express = require('express');
const path = require('path');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { saveMessage, getRecentMessages } = require('./db');

// Serve static assets
app.use('/public', express.static(path.join(__dirname, 'public')));

// Serve index.html on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== In-Memory State ====================

// Connected users: socket.id -> { id, username }
const users = {};

// Available rooms (channels). We start with two default rooms.
// Structure: { "general": { name: "general", creator: "system" }, ... }
const rooms = {
  general: { name: 'general', creator: 'system' },
  random: { name: 'random', creator: 'system' }
};

// ==================== Rate Limiter (Anti-Spam) ====================
// Config: Max 5 messages within a 3-second sliding window per socket
const RATE_LIMIT_WINDOW_MS = 3000;
const MAX_MESSAGES_PER_WINDOW = 5;
const messageTimestamps = new Map(); // socket.id -> Array<number>

/**
 * Check if a socket is exceeding the message rate limit
 * @param {string} socketId 
 * @returns {boolean} True if rate limit is exceeded
 */
function isRateLimited(socketId) {
  const now = Date.now();
  const timestamps = messageTimestamps.get(socketId) || [];

  // Filter timestamps within current sliding window
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= MAX_MESSAGES_PER_WINDOW) {
    messageTimestamps.set(socketId, recent);
    return true; // Exceeded limit
  }

  recent.push(now);
  messageTimestamps.set(socketId, recent);
  return false;
}

// ==================== Helper Functions ====================

// Generate a consistent DM room key from two usernames
// Sorting alphabetically ensures "dm_alice_bob" is always the same regardless of who initiates
function getDmRoomKey(user1, user2) {
  const sorted = [user1, user2].sort();
  return `dm_${sorted[0]}_${sorted[1]}`;
}

// Get the current timestamp formatted as HH:MM
function getTimeStr() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ==================== Socket.IO Events ====================

io.on('connection', (socket) => {

  // ---- User Join ----
  socket.on('user_join', async (username) => {
    const trimmed = (username || '').trim();
    if (!trimmed) return;

    socket.username = trimmed;
    users[socket.id] = { id: socket.id, username: trimmed };

    // Auto-join the 'general' room by default
    socket.join('general');
    socket.currentRoom = 'general';

    // Send success + room list + user list
    socket.emit('join_success', {
      username: trimmed,
      rooms: Object.keys(rooms),
      users: Object.values(users),
      currentRoom: 'general'
    });

    // Fetch and send chat history for #general from PostgreSQL
    const history = await getRecentMessages('general', 50);
    socket.emit('load_history', history);

    // Notify everyone in #general
    socket.to('general').emit('system_message', {
      text: `${trimmed} joined the chat`,
      type: 'join',
      room: 'general',
      time: getTimeStr()
    });

    // Update the global user list for everyone
    io.emit('update_users', Object.values(users));
  });

  // ---- Switch Room (Channel) ----
  socket.on('switch_room', async (roomName) => {
    if (!socket.username || !roomName) return;
    const room = roomName.toLowerCase().trim();

    // Only allow switching to rooms that exist
    if (!rooms[room]) return;

    // Leave the previous room
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
    }

    // Join the new room
    socket.join(room);
    socket.currentRoom = room;

    // Send confirmation + history for the new room from PostgreSQL
    socket.emit('room_switched', { room });
    const history = await getRecentMessages(room, 50);
    socket.emit('load_history', history);
  });

  // ---- Create a New Room ----
  socket.on('create_room', (roomName) => {
    if (!socket.username || !roomName) return;

    // Sanitize room name: lowercase, alphanumeric + hyphens only, max 20 chars
    const clean = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
    if (!clean || rooms[clean]) {
      socket.emit('room_error', { message: `Room "${clean}" already exists or is invalid.` });
      return;
    }

    // Register the new room
    rooms[clean] = { name: clean, creator: socket.username };

    // Notify ALL connected clients about the new room
    io.emit('room_created', { room: clean, rooms: Object.keys(rooms) });
  });

  // ---- Send Message (to current room or DM) ----
  socket.on('send_message', async (data) => {
    if (!socket.username || !data || !data.message) return;

    // Rate limiting check
    if (isRateLimited(socket.id)) {
      socket.emit('rate_limit_exceeded', {
        message: '⚠️ Slow down! You are sending messages too quickly.'
      });
      return;
    }

    const msg = String(data.message).trim();
    if (!msg) return;

    // Target room is explicit or falls back to socket's current active room
    const targetRoom = (data.room || socket.currentRoom || 'general').trim();

    const payload = {
      senderId: socket.id,
      username: socket.username,
      message: msg,
      room: targetRoom,
      isDm: targetRoom.startsWith('dm_'),
      time: getTimeStr()
    };

    // Save message to PostgreSQL asynchronously
    await saveMessage(targetRoom, socket.username, msg, payload.time);

    // Broadcast to all sockets in that room
    io.to(targetRoom).emit('receive_message', payload);
  });

  // ---- Open a Direct Message ----
  socket.on('open_dm', async (targetUsername) => {
    if (!socket.username || !targetUsername) return;
    if (targetUsername === socket.username) return; // Can't DM yourself

    // Find the target user's socket ID
    const targetEntry = Object.values(users).find(u => u.username === targetUsername);
    if (!targetEntry) return;

    // Generate the DM room key (consistent regardless of who initiates)
    const dmRoom = getDmRoomKey(socket.username, targetUsername);

    // Both users join this private DM room
    socket.join(dmRoom);
    socket.currentRoom = dmRoom;

    // Also make the target user join the DM room
    const targetSocket = io.sockets.sockets.get(targetEntry.id);
    if (targetSocket) {
      targetSocket.join(dmRoom);
    }

    // Send confirmation + DM history to the initiator from PostgreSQL
    socket.emit('dm_opened', {
      room: dmRoom,
      withUser: targetUsername
    });
    const history = await getRecentMessages(dmRoom, 50);
    socket.emit('load_history', history);
  });

  // ---- Typing Indicator ----
  socket.on('typing', (data) => {
    if (!socket.username) return;
    const room = (data && data.room) || socket.currentRoom || 'general';
    socket.to(room).emit('user_typing', {
      username: socket.username,
      isTyping: Boolean(data && data.isTyping !== undefined ? data.isTyping : data)
    });
  });

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    // Clean up rate limiting memory
    messageTimestamps.delete(socket.id);

    if (socket.username) {
      const username = socket.username;
      delete users[socket.id];

      io.emit('system_message', {
        text: `${username} left the chat`,
        type: 'leave',
        time: getTimeStr()
      });

      io.emit('update_users', Object.values(users));
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});