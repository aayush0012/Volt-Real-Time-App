# Volt - Real-Time Messaging Platform

Volt is a high-performance, full-duplex real-time communication platform engineered with Node.js, Express, Socket.IO, PostgreSQL, and modern Vanilla JavaScript/CSS. It features multi-channel room multiplexing, private 1-on-1 direct messaging, database persistence, in-memory rate limiting, and debounced typing indicators.

---

## Features

- **Bi-Directional Real-Time Transport**: Low-latency message delivery using WebSocket protocol with Socket.IO fallback.
- **Multi-Channel Rooms**: Dynamic channel creation and room multiplexing (`socket.join` / `socket.leave`) isolating message traffic per channel.
- **1-on-1 Private Direct Messaging**: Deterministic conversation pairing algorithms ensuring isolated private histories between participants.
- **Relational Data Persistence (PostgreSQL)**: Asynchronous message history hydration with indexed queries (`room`, `id DESC`) and connection pooling.
- **In-Memory Rate Limiting & Anti-Spam**: Sliding-window rate limiter enforcing message thresholds per socket to protect database connections from packet flood attacks.
- **Live Presence & Typing Indicators**: Real-time connected user tracking with debounced typing state synchronization.
- **Modern Responsive Interface**: Clean, dark obsidian theme with adaptive layouts, custom avatar hashing, and zero external frontend dependencies.
- **XSS Sanitization**: Client-side HTML escaping protecting against script injection across message payloads.

---

## Architecture Overview

```
Client (Browser) <---- WebSocket / Socket.IO ----> Node.js / Express Server
                                                           |
                                                +----------+----------+
                                                |                     |
                                         PostgreSQL Pool      In-Memory State
                                         (Message History)    - Sockets / Users
                                                              - Rate Limiter Map
                                                              - Active Channels
```

---

## Tech Stack

- **Runtime**: Node.js
- **Server Framework**: Express
- **Real-Time Engine**: Socket.IO
- **Database**: PostgreSQL (`pg` connection pool)
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 Custom Properties
- **Environment Management**: Dotenv

---

## Getting Started

### Prerequisites

- Node.js (v16+ recommended)
- PostgreSQL database (Local instance or Cloud provider such as Neon / Supabase)

### 1. Clone the Repository

```bash
git clone https://github.com/aayush0012/Volt-Real-Time-App.git
cd Volt-Real-Time-App
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory (refer to `.env.example`):

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
PORT=3000
```

### 4. Start the Application

```bash
npm start
```

The server will initialize the database schema automatically and listen on `http://localhost:3000`.

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  room       VARCHAR(100) NOT NULL,
  username   VARCHAR(100) NOT NULL,
  message    TEXT NOT NULL,
  time       VARCHAR(20) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_room_id 
ON messages (room, id DESC);
```

---

## Socket Event Lifecycle

| Event | Direction | Description |
| :--- | :--- | :--- |
| `user_join` | Client -> Server | Registers user, joins default channel `#general`, emits user list. |
| `switch_room` | Client -> Server | Leaves active room, joins target channel, hydrates message history. |
| `create_room` | Client -> Server | Validates and registers new channel, broadcasts update to all clients. |
| `open_dm` | Client -> Server | Creates/joins private DM room for both participants, fetches DM history. |
| `send_message` | Client -> Server | Rate-limits payload, persists to PostgreSQL, broadcasts to room. |
| `rate_limit_exceeded` | Server -> Client | Notifies client when message frequency threshold is exceeded. |
| `typing` | Client -> Server | Broadcasts debounced typing state to participants in the active room. |
| `disconnect` | Socket Lifecycle | Removes user from registry, frees rate limiter memory, notifies clients. |

---

## License

ISC License.
