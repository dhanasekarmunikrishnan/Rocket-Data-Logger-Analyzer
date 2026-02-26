/**
 * Settings Routes  -  API key management with in-memory AES-256-GCM encryption
 */

const express = require('express');
const router = express.Router();
const db = require('../services/database');

/* Callback set by server.js to re-init chatbot when key changes */
let onApiKeyChanged = null;
router.setOnApiKeyChanged = (cb) => { onApiKeyChanged = cb; };

/* Get the currently stored API key (decrypted), for internal use */
router.getStoredApiKey = () => {
  return db.getApiKey('gemini');
};

/* GET /api/settings/status  -  check if a key is configured */
router.get('/status', (_, res) => {
  const status = db.getApiKeyStatus('gemini');
  
  if (status) {
    res.json({
      hasKey: true,
      keyPreview: '***...***',
      encryption: 'AES-256-GCM',
      storage: 'In-Memory (encrypted)',
      ...status
    });
  } else {
    res.json({
      hasKey: false,
      keyPreview: null,
      encryption: 'AES-256-GCM',
      storage: 'In-Memory (encrypted)',
      configured: false
    });
  }
});

/* POST /api/settings/api-key  -  save encrypted API key to SQLite */
router.post('/api-key', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
      return res.status(400).json({ error: 'Invalid API key. Must be at least 10 characters.' });
    }

    const trimmed = apiKey.trim();
    db.saveApiKey('gemini', trimmed, 'Google Gemini API Key');

    /* Re-initialise chatbot with new key */
    if (onApiKeyChanged) onApiKeyChanged(trimmed);

    const preview = trimmed.substring(0, 6) + '...' + trimmed.substring(trimmed.length - 4);
    res.json({ 
      success: true, 
      keyPreview: preview, 
      encryption: 'AES-256-GCM',
      storage: 'In-Memory (encrypted)'
    });
  } catch (e) {
    console.error('  [settings] Save error:', e);
    res.status(500).json({ error: 'Failed to save API key: ' + e.message });
  }
});

/* DELETE /api/settings/api-key  -  remove stored API key from SQLite */
router.delete('/api-key', (_, res) => {
  try {
    db.deleteApiKey('gemini');

    /* Re-init chatbot without key (fallback mode) */
    if (onApiKeyChanged) onApiKeyChanged(null);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove API key: ' + e.message });
  }
});

module.exports = router;
