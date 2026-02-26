/**
 * In-Memory Database Module - Chat History & API Key Storage
 * Pure JS replacement for better-sqlite3 (Vercel-compatible, no native addons)
 *
 * NOTE: Data is ephemeral on serverless — each cold-start resets state.
 * For persistent storage on Vercel, swap this for Vercel KV / Postgres / Turso.
 */

const crypto = require('crypto');
const os = require('os');

const ALGORITHM = 'aes-256-gcm';

/* -------- In-memory stores -------- */
const chatSessions = new Map();
const chatMessages = new Map();
const apiKeys = new Map();
let msgAutoId = 0;

/* -------- Init (no-op for in-memory) -------- */
function initializeDatabase() {
  console.log('  [database] In-memory store initialised (Vercel-compatible, no native addons)');
}

/* -------- Encryption helpers -------- */

function deriveKey() {
  const hostname = os.hostname();
  const salt = 'rocket-dla-2024-spacex-crs16';
  return crypto.scryptSync(hostname + salt, 'rocket-salt', 32);
}

function encryptValue(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { encrypted, iv: iv.toString('hex'), authTag };
}

function decryptValue(data) {
  const key = deriveKey();
  const iv = Buffer.from(data.iv, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));
  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/* -------- Chat Session Management -------- */

function createChatSession(sessionId, metadata = null) {
  const now = new Date().toISOString();
  chatSessions.set(sessionId, {
    sessionId,
    createdAt: now,
    updatedAt: now,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
  if (!chatMessages.has(sessionId)) chatMessages.set(sessionId, []);
  return sessionId;
}

function getChatSession(sessionId) {
  return chatSessions.get(sessionId) || null;
}

function addChatMessage(sessionId, role, content, chartRequest = null) {
  if (!getChatSession(sessionId)) createChatSession(sessionId);

  const msgs = chatMessages.get(sessionId) || [];
  const id = ++msgAutoId;
  msgs.push({
    id,
    role,
    content,
    chartRequest: chartRequest ? JSON.stringify(chartRequest) : null,
    createdAt: new Date().toISOString(),
  });
  chatMessages.set(sessionId, msgs);

  const session = chatSessions.get(sessionId);
  if (session) session.updatedAt = new Date().toISOString();
  return id;
}

function getChatHistory(sessionId, limit = 50) {
  const msgs = chatMessages.get(sessionId) || [];
  return msgs.slice(-limit).map((m) => ({
    ...m,
    chartRequest: m.chartRequest ? JSON.parse(m.chartRequest) : null,
  }));
}

function clearChatHistory(sessionId) {
  chatMessages.set(sessionId, []);
  const session = chatSessions.get(sessionId);
  if (session) session.updatedAt = new Date().toISOString();
  return true;
}

function getAllChatSessions() {
  const sessions = [];
  for (const [id, session] of chatSessions) {
    const msgs = chatMessages.get(id) || [];
    const firstUserMsg = msgs.find(m => m.role === 'User');
    sessions.push({
      ...session,
      title: firstUserMsg ? firstUserMsg.content.substring(0, 80) : 'New Chat',
      messageCount: msgs.length,
    });
  }
  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return sessions;
}

function deleteChatSession(sessionId) {
  chatSessions.delete(sessionId);
  chatMessages.delete(sessionId);
  return true;
}

/* -------- API Key Management -------- */

function saveApiKey(keyName, apiKeyValue, description = null) {
  const { encrypted, iv, authTag } = encryptValue(apiKeyValue);
  const now = new Date().toISOString();
  apiKeys.set(keyName, {
    encryptedKey: encrypted,
    iv,
    authTag,
    description,
    createdAt: now,
    updatedAt: now,
    lastUsed: null,
    isActive: true,
  });
  const preview = apiKeyValue.substring(0, 6) + '...' + apiKeyValue.substring(apiKeyValue.length - 4);
  console.log(`  [database] API key saved (${preview})`);
  return true;
}

function getApiKey(keyName = 'gemini') {
  const row = apiKeys.get(keyName);
  if (!row || !row.isActive) return null;
  try {
    const decrypted = decryptValue(row);
    row.lastUsed = new Date().toISOString();
    return decrypted;
  } catch {
    return null;
  }
}

function getApiKeyStatus(keyName = 'gemini') {
  const row = apiKeys.get(keyName);
  if (!row) return null;
  return {
    keyName,
    configured: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsed: row.lastUsed,
    isActive: row.isActive,
    description: row.description,
  };
}

function deleteApiKey(keyName = 'gemini') {
  apiKeys.delete(keyName);
  console.log(`  [database] API key removed (${keyName})`);
  return true;
}

/* -------- Exports -------- */
module.exports = {
  initializeDatabase,
  createChatSession,
  getChatSession,
  addChatMessage,
  getChatHistory,
  clearChatHistory,
  getAllChatSessions,
  deleteChatSession,
  saveApiKey,
  getApiKey,
  getApiKeyStatus,
  deleteApiKey,
  encryptValue,
  decryptValue,
  deriveKey,
};
