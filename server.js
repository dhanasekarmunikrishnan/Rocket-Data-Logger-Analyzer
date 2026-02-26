/**
 * Rocket Data Logger & Analyzer  -  Server
 * Compatible with Vercel serverless & local development
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

// Initialize in-memory database
const db = require('./services/database');
db.initializeDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const apiRoutes = require('./routes/api');
const chatbotRoutes = require('./routes/chatbot');
const settingsRoutes = require('./routes/settings');

app.use('/api', apiRoutes);
app.use('/api/chat', chatbotRoutes);
app.use('/api/settings', settingsRoutes);

/* Initialise chatbot: prefer stored encrypted key from DB, then .env key */
const storedKey = db.getApiKey('gemini');
const envKey = process.env.GEMINI_API_KEY;
const activeKey = storedKey || (envKey && envKey !== 'YOUR_GEMINI_API_KEY_HERE' ? envKey : null);
chatbotRoutes.initialize(activeKey, apiRoutes.getDataContext);

/* Allow settings route to re-initialise chatbot when key changes */
settingsRoutes.setOnApiKeyChanged((newKey) => {
  chatbotRoutes.initialize(newKey, apiRoutes.getDataContext);
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  console.error('Server Error:', err);
  res.status(500).json({ error: err.message });
});

/* Only listen when running locally (not on Vercel serverless) */
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`
  +------------------------------------------------------+
  |   ROCKET DATA LOGGER & ANALYZER                      |
  |   Server running at http://localhost:${PORT}             |
  |                                                      |
  |   Dashboard:  http://localhost:${PORT}                   |
  |   API:        http://localhost:${PORT}/api/status         |
  +------------------------------------------------------+
    `);
  });
}

/* Export for Vercel serverless */
module.exports = app;
