'use strict';

// ==================== Socket Connection ====================
const socket = io();

// ==================== App State ====================
let currentUsername = '';
let currentUserId = '';
let currentRoom = 'general';   // Currently active room or DM key
let currentDmUser = '';         // If in a DM, who are we chatting with
let typingTimeout = null;

// ==================== DOM References ====================
const joinScreen = document.getElementById('join-screen');
const chatScreen = document.getElementById('chat-screen');
const joinForm = document.getElementById('join-form');
const usernameInput = document.getElementById('username-input');

const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messagesContainer = document.getElementById('messages-container');
const chatTitle = document.getElementById('chat-title');
const userCountBadge = document.getElementById('user-count-badge');
const myUsernameDisplay = document.getElementById('my-username-display');
const myAvatar = document.getElementById('my-avatar');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const sidebar = document.getElementById('chat-sidebar');

// Room/channel elements
const roomList = document.getElementById('room-list');
const dmUserList = document.getElementById('dm-user-list');
const createRoomBtn = document.getElementById('create-room-btn');
const createRoomModal = document.getElementById('create-room-modal');
const createRoomForm = document.getElementById('create-room-form');
const roomNameInput = document.getElementById('room-name-input');
const cancelCreateRoom = document.getElementById('cancel-create-room');

// ==================== Avatar Colors ====================
const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#10b981', '#06b6d4', '#3b82f6'
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ==================== XSS Protection ====================
function escapeHtml(unsafe) {
  return (unsafe || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==================== 1. Join Flow ====================

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (!name) return;
  currentUsername = name;
  sessionStorage.setItem('chat_username', name);
  socket.emit('user_join', name);
});

// Auto-rejoin on reload
const savedUsername = sessionStorage.getItem('chat_username');
if (savedUsername) {
  currentUsername = savedUsername;
  socket.emit('user_join', savedUsername);
}

// Server confirms join
socket.on('join_success', (data) => {
  currentUserId = socket.id;
  currentRoom = data.currentRoom || 'general';
  sessionStorage.setItem('chat_username', currentUsername);

  // Switch screens
  joinScreen.classList.remove('active');
  chatScreen.classList.add('active');

  // Set profile in sidebar
  myUsernameDisplay.textContent = currentUsername;
  myAvatar.textContent = currentUsername.charAt(0).toUpperCase();
  myAvatar.style.backgroundColor = getAvatarColor(currentUsername);

  // Render room list
  renderRoomList(data.rooms);

  // Update header
  chatTitle.textContent = `# ${currentRoom}`;

  messageInput.focus();
});

// ==================== 2. Room (Channel) Management ====================

let pendingCreatedRoom = null;

// Render the list of channels in the sidebar
function renderRoomList(roomNames) {
  roomList.innerHTML = '';
  roomNames.forEach((name) => {
    const li = document.createElement('li');
    li.className = `nav-item ${name === currentRoom && !currentDmUser ? 'active' : ''}`;
    li.dataset.room = name;
    li.innerHTML = `<span class="nav-icon">#</span> <span class="room-name">${escapeHtml(name)}</span>`;
    li.addEventListener('click', () => switchRoom(name));
    roomList.appendChild(li);
  });
}

// Switch to a different channel
function switchRoom(roomName) {
  if (roomName === currentRoom && !currentDmUser) return;

  currentRoom = roomName;
  currentDmUser = '';  // Clear any active DM
  chatTitle.textContent = `# ${roomName}`;

  // Clear messages
  clearMessages();

  // Highlight active room in sidebar
  document.querySelectorAll('#room-list .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.room === roomName);
  });
  document.querySelectorAll('#dm-user-list .nav-item').forEach(el => {
    el.classList.remove('active');
  });

  // Tell server to switch rooms
  socket.emit('switch_room', roomName);
  messageInput.focus();
}

// Server confirms room switch
socket.on('room_switched', (data) => {
  currentRoom = data.room;
});

// Create room modal
createRoomBtn.addEventListener('click', () => {
  createRoomModal.classList.remove('hidden');
  roomNameInput.value = '';
  roomNameInput.focus();
});

cancelCreateRoom.addEventListener('click', () => {
  createRoomModal.classList.add('hidden');
});

createRoomForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = roomNameInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!name) return;
  pendingCreatedRoom = name;
  socket.emit('create_room', name);
  createRoomModal.classList.add('hidden');
});

// Server confirms new room was created
socket.on('room_created', (data) => {
  renderRoomList(data.rooms);
  // If this client created the room, switch to it automatically
  if (pendingCreatedRoom && data.rooms.includes(pendingCreatedRoom)) {
    switchRoom(pendingCreatedRoom);
    pendingCreatedRoom = null;
  }
});

// Room error
socket.on('room_error', (data) => {
  alert(data.message);
  pendingCreatedRoom = null;
});

// ==================== 3. Direct Messages ====================

// Render the online users list in the DM section of the sidebar
function renderDmUserList(users) {
  dmUserList.innerHTML = '';
  users.forEach((u) => {
    // Don't show yourself in the DM list
    if (u.username === currentUsername) return;

    const color = getAvatarColor(u.username);
    const initial = u.username.charAt(0).toUpperCase();

    const li = document.createElement('li');
    li.className = `nav-item dm-item ${currentDmUser === u.username ? 'active' : ''}`;
    li.dataset.username = u.username;
    li.innerHTML = `
      <div class="dm-avatar" style="background-color: ${color}">${initial}</div>
      <span class="dm-name">${escapeHtml(u.username)}</span>
      <span class="online-dot"></span>
    `;
    li.addEventListener('click', () => openDm(u.username));
    dmUserList.appendChild(li);
  });
}

// Open a DM conversation with a user
function openDm(targetUsername) {
  if (targetUsername === currentUsername) return;

  currentDmUser = targetUsername;
  chatTitle.textContent = `💬 ${targetUsername}`;

  // Clear messages
  clearMessages();

  // Deselect channel highlights, highlight this DM
  document.querySelectorAll('#room-list .nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('#dm-user-list .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.username === targetUsername);
  });

  // Tell server to open a DM room
  socket.emit('open_dm', targetUsername);
  messageInput.focus();
}

// Server confirms DM room is open
socket.on('dm_opened', (data) => {
  currentRoom = data.room;
  currentDmUser = data.withUser;
});

// ==================== 4. Sending Messages ====================

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  socket.emit('send_message', { message: text, room: currentRoom });
  messageInput.value = '';

  socket.emit('typing', { isTyping: false, room: currentRoom });
  if (typingTimeout) clearTimeout(typingTimeout);
  messageInput.focus();
});

// ==================== 5. Typing Indicator ====================

messageInput.addEventListener('input', () => {
  socket.emit('typing', { isTyping: true, room: currentRoom });

  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', { isTyping: false, room: currentRoom });
  }, 1500);
});

socket.on('user_typing', (data) => {
  if (data.isTyping) {
    typingText.textContent = `${data.username} is typing...`;
    typingIndicator.classList.remove('hidden');
  } else {
    typingIndicator.classList.add('hidden');
  }
  scrollToBottom();
});

// ==================== 6. Receiving Messages ====================

// Load history (from DB, sent on join or room switch)
socket.on('load_history', (messages) => {
  clearMessages();
  if (!messages || messages.length === 0) {
    const welcome = document.createElement('div');
    welcome.className = 'welcome-banner';
    welcome.innerHTML = `
      <span class="welcome-icon">💬</span>
      <p>No messages yet. Send a message to start the conversation!</p>
    `;
    messagesContainer.appendChild(welcome);
    return;
  }
  messages.forEach((data) => {
    const isSelf = data.username === currentUsername;
    appendMessage(data, isSelf);
  });
  scrollToBottom();
});

// Real-time incoming message
socket.on('receive_message', (data) => {
  // Only render if it belongs to the room we're currently viewing
  if (data.room !== currentRoom) return;
  const isSelf = data.username === currentUsername || data.senderId === socket.id;
  appendMessage(data, isSelf);
  scrollToBottom();
});

// Append a single message bubble to the container
function appendMessage(data, isSelf) {
  const color = getAvatarColor(data.username);
  const initial = data.username.charAt(0).toUpperCase();

  const msgRow = document.createElement('div');
  msgRow.className = `message-row ${isSelf ? 'self' : 'other'}`;

  if (isSelf) {
    msgRow.innerHTML = `
      <div class="message-bubble">
        <div class="message-text">${escapeHtml(data.message)}</div>
        <div class="message-time">${data.time}</div>
      </div>
    `;
  } else {
    msgRow.innerHTML = `
      <div class="message-avatar" style="background-color: ${color}">${initial}</div>
      <div class="message-bubble">
        <div class="message-sender">${escapeHtml(data.username)}</div>
        <div class="message-text">${escapeHtml(data.message)}</div>
        <div class="message-time">${data.time}</div>
      </div>
    `;
  }

  messagesContainer.appendChild(msgRow);
}

// ==================== 7. System Notifications ====================

socket.on('system_message', (data) => {
  const sysDiv = document.createElement('div');
  sysDiv.className = 'system-msg';
  sysDiv.innerHTML = `<span>${data.type === 'join' ? '👋' : '🚪'} ${escapeHtml(data.text)}</span>`;
  messagesContainer.appendChild(sysDiv);
  scrollToBottom();
});

// ==================== 8. User List Updates ====================

socket.on('update_users', (users) => {
  userCountBadge.textContent = users.length;
  renderDmUserList(users);
});

// ==================== 9. Mobile Sidebar Toggle ====================

if (toggleSidebarBtn) {
  toggleSidebarBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
}

// ==================== 10. Toast Notifications ====================

function showToast(message) {
  let toast = document.getElementById('chat-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'chat-toast';
    toast.className = 'chat-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  
  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}

socket.on('rate_limit_exceeded', (data) => {
  showToast(data.message || '⚠️ Slow down! You are sending messages too fast.');
});

// ==================== Utilities ====================

function clearMessages() {
  messagesContainer.innerHTML = '';
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
