"use strict";

require('dotenv').config();
const { Pool } = require('pg');

// Create a PostgreSQL connection pool
// Reads DATABASE_URL from .env or environment, with fallback to local postgres
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

const pool = new Pool({
  connectionString,
  // If connecting to remote databases (e.g. Supabase, Neon, Render, Heroku) over SSL:
  ssl: connectionString.includes('sslmode=require') || isProduction
    ? { rejectUnauthorized: false }
    : false
});

// Initialize database schema
async function initDb() {
  try {
    const client = await pool.connect();
    console.log('[PostgreSQL] Connected successfully to database');

    // Create messages table with room column and auto-incrementing SERIAL id
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id         SERIAL PRIMARY KEY,
        room       VARCHAR(100) NOT NULL,
        username   VARCHAR(100) NOT NULL,
        message    TEXT NOT NULL,
        time       VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create an index on room for fast retrieval of recent messages
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_room_id 
      ON messages (room, id DESC);
    `);

    client.release();
  } catch (err) {
    console.error('[PostgreSQL Error] Database initialization failed:', err.message);
    console.warn('[PostgreSQL Warning] Please verify your database connection in .env (DATABASE_URL)');
  }
}

// Run initial schema creation
initDb();

/**
 * Save a message to a specific room/channel/DM
 * @param {string} room - Channel name (e.g., "general", "random") or DM identifier (e.g., "dm_alice_bob")
 * @param {string} username - Author username
 * @param {string} message - Message text
 * @param {string} time - Formatted timestamp (e.g., "10:15 AM")
 */
async function saveMessage(room, username, message, time) {
  const query = `
    INSERT INTO messages (room, username, message, time)
    VALUES ($1, $2, $3, $4)
    RETURNING id, created_at;
  `;
  try {
    const res = await pool.query(query, [room, username, message, time]);
    return res.rows[0];
  } catch (err) {
    console.error('[PostgreSQL Error] Failed to save message:', err.message);
    return null;
  }
}

/**
 * Fetch the most recent N messages from a specific room, in chronological order
 * @param {string} room - Channel name or DM identifier
 * @param {number} limit - Maximum number of messages to fetch (default: 50)
 * @returns {Promise<Array>} List of messages
 */
async function getRecentMessages(room, limit = 50) {
  const query = `
    SELECT username, message, time
    FROM (
      SELECT id, username, message, time
      FROM messages
      WHERE room = $1
      ORDER BY id DESC
      LIMIT $2
    ) sub
    ORDER BY id ASC;
  `;
  try {
    const res = await pool.query(query, [room, limit]);
    return res.rows;
  } catch (err) {
    console.error('[PostgreSQL Error] Failed to get messages:', err.message);
    return [];
  }
}

module.exports = {
  pool,
  saveMessage,
  getRecentMessages
};
