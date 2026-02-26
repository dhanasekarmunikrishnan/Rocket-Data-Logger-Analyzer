# Chat Data Persistence & API Key Security - Implementation Guide

## Overview
Your Rocket Data Logger & Analyzer application has been upgraded with persistent SQLite storage for:
1. **Chat History** - All messages are now persisted in the database
2. **API Keys** - Gemini API keys are stored securely with AES-256-GCM encryption in SQLite
3. **Session Management** - Support for multiple independent chat sessions

---

## What Changed

### 1. **New SQLite Database System** (`services/database.js`)
A new database module handles all persistent storage with the following features:

#### Database Schema:
- **`chat_sessions`** - Stores chat session metadata
  - `sessionId`: Unique identifier (UUID)
  - `createdAt`: Session creation timestamp
  - `updatedAt`: Last activity timestamp
  - `metadata`: Optional JSON metadata

- **`chat_messages`** - Stores individual messages
  - `sessionId`: Links to chat_sessions
  - `role`: "User" or "Assistant"
  - `content`: Message text
  - `chartRequest`: JSON chart configuration (if applicable)
  - `createdAt`: Message timestamp

- **`api_keys`** - Stores encrypted API keys
  - `keyName`: Key identifier (e.g., "gemini")
  - `encryptedKey`: AES-256-GCM encrypted key
  - `iv`: Initialization vector
  - `authTag`: Authentication tag
  - `description`: Key description
  - `isActive`: Enable/disable flag
  - `lastUsed`: Last access timestamp

#### Security:
- **AES-256-GCM encryption** for all API keys
- **Machine-specific key derivation** using hostname + static salt
- Authentication tags prevent tampering
- Keys never stored in plaintext
- Encryption key never leaves the machine

---

### 2. **Updated Settings Routes** (`routes/settings.js`)
Now uses SQLite for API key management instead of file-based encryption:

**Endpoints:**
- `GET /api/settings/status` - Check if API key is configured
- `POST /api/settings/api-key` - Save encrypted API key
- `DELETE /api/settings/api-key` - Remove stored API key

**Response Format:**
```json
{
  "hasKey": true,
  "keyPreview": "***...***",
  "encryption": "AES-256-GCM",
  "storage": "SQLite",
  "createdAt": "2026-02-25T06:16:00.000Z",
  "updatedAt": "2026-02-25T06:16:00.000Z",
  "lastUsed": "2026-02-25T06:16:05.000Z",
  "isActive": true
}
```

---

### 3. **Enhanced Chatbot Service** (`services/geminiService.js`)
Now supports session-based persistent chat:

**Features:**
- **Session-aware chat** - Each session maintains its own conversation history
- **Database persistence** - All messages automatically saved to SQLite
- **Chart requests included** - Always returns text + chart data together
- **Conversation recovery** - Reload previous sessions from database
- **History management** - Trim old messages automatically (keeps last 50)

**Key Changes:**
- Constructor takes `sessionId` parameter
- `chat()` method now persists messages automatically
- `getHistory()` retrieves previous messages from database
- `resetChat()` clears session history in database

---

### 4. **Session-Based Chat Routes** (`routes/chatbot.js`)
New endpoints for session management:

**New Endpoints:**
```
POST   /api/chat/session              - Create a new chat session
GET    /api/chat/history/:sessionId   - Get chat history for a session
POST   /api/chat                      - Send message (supports sessionId)
POST   /api/chat/reset                - Clear history for a session
```

**Example Usage:**

Create a session:
```bash
POST http://localhost:3000/api/chat/session
Response: { "sessionId": "uuid-...", "createdAt": "..." }
```

Send message:
```bash
POST http://localhost:3000/api/chat
{
  "message": "Show velocity profile",
  "sessionId": "uuid-..."
}
Response: {
  "text": "## Velocity Profile...",
  "chartRequest": { "type": "line", "params": [...] },
  "sessionId": "uuid-...",
  "persistedToDB": true
}
```

Get history:
```bash
GET http://localhost:3000/api/chat/history/uuid-...
Response: {
  "sessionId": "uuid-...",
  "messageCount": 5,
  "messages": [...]
}
```

---

### 5. **Updated Server Initialization** (`server.js`)
- Database initialization on startup
- API key loaded from SQLite instead of file system
- Automatic schema creation on first run

---

## Database Location
SQLite database file: `PROJECT/data/data.db`

This file contains:
- All chat conversations
- All encrypted API keys
- Session metadata

**Backup Recommendation:** Regularly backup this file!

---

## Migration from Old System

The old `.settings.enc` file (file-based encryption) is no longer used. 

**What happens to old API keys?**
- If you had an old `.settings.enc` file, you need to re-enter your API key once
- The new system will store it securely in SQLite
- Old file can be safely deleted

---

## API Key Security Details

### Encryption Process:
1. **Derive Key**: Using `scrypt(hostname + salt, ...)` → 256-bit key
2. **Generate IV**: Random 16-byte initialization vector
3. **Encrypt**: Using AES-256-GCM cipher
4. **Get AuthTag**: AEAD authentication tag for integrity
5. **Store**: IV, ciphertext, and auth tag in database

### Decryption Process:
1. Load encrypted data, IV, and auth tag from database
2. Derive key (same process)
3. Decrypt using AES-256-GCM
4. Verify auth tag (prevents tampering)
5. Return plaintext key for use

### Security Properties:
- ✅ **Confidentiality**: AES-256-GCM encryption
- ✅ **Authentication**: AEAD prevents tampering
- ✅ **Machine-Binding**: Key tied to hostname
- ✅ **No Plaintext Storage**: Keys never written to disk unencrypted
- ⚠️ **Local Only**: Not for multi-machine scenarios (keys are machine-specific)

---

## Chat History Persistence

### What Gets Stored:
- Message text (both user and assistant)
- Message timestamps
- Chart requests (if any)
- Session metadata

### What Gets Loaded:
- Full conversation history on session request
- Used to provide context for AI analysis
- Allows conversation recovery after restart

### Cleanup:
- Only recent 50 messages kept per session (configurable)
- Old messages automatically trimmed
- Can manually clear session with `/api/chat/reset`

---

## Chatbot Responses

### Format Guaranteed:
Every chatbot response now includes:
1. **Text Response** - Comprehensive analysis/answer
2. **Chart Request** (if applicable) - Visualization config
3. **Session ID** - For tracking
4. **Persistence Status** - Whether saved to database

Example:
```json
{
  "text": "## Velocity Profile\n\nDuring the ascent phase, the velocity...",
  "chartRequest": {
    "type": "line",
    "params": ["velocity_ms"],
    "title": "Velocity",
    "highlightAnomalies": true
  },
  "sessionId": "...",
  "persistedToDB": true
}
```

This ensures both text analysis AND visualization data are always available.

---

## Database Indexes

For optimal performance, the following indexes are created:
- `chat_messages.sessionId` - Fast lookup by session
- `chat_messages.createdAt` - Fast chronological queries

---

## Testing the Implementation

### Test 1: Create a Session
```bash
curl -X POST http://localhost:3000/api/chat/session
```

### Test 2: Send a Message
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Show velocity","sessionId":"your-session-id"}'
```

### Test 3: Retrieve History
```bash
curl http://localhost:3000/api/chat/history/your-session-id
```

### Test 4: Verify Persistence
- Restart the server
- Retrieve the same session - history should still be there!

---

## Dependencies Added

- `better-sqlite3` - SQLite database driver
- `uuid` - Session ID generation

Install with: `npm install`

---

## Future Enhancements

1. **Database Migrations** - Handle schema updates
2. **Export/Import** - Backup conversations as JSON
3. **Search** - Find messages across sessions
4. **User Accounts** - Multiple user support
5. **HSM Integration** - Enterprise-grade key storage
6. **Encryption at Rest** - Encrypt entire database file

---

## Troubleshooting

### Database Locked Error
- Close other connections to the database
- Check for running instances of the server

### Decryption Failed
- Ensure same machine (hostname-based key)
- Check SQLite file integrity
- Re-enter API key

### Old API Key Still Used
- Check `.env` file - remove if still present
- Database takes priority, but `.env` acts as fallback

---

## Configuration

### Customize Database Location:
Edit `services/database.js`:
```javascript
const DB_PATH = path.join(__dirname, '..', 'data', 'data.db');
```

### Adjust Message Retention:
Edit `services/database.js` in `getChatHistory()`:
```javascript
LIMIT ? // Change the number here
```

---

## Summary

Your application now has:
✅ **Persistent chat history** in SQLite  
✅ **Secure API key storage** with AES-256-GCM  
✅ **Session management** for multiple conversations  
✅ **Response + Chart data** in every response  
✅ **No plaintext key storage**  
✅ **Machine-bound encryption**  

All data is stored securely in `data/data.db` and protected with encryption.
