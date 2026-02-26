/**
 * Chatbot Routes  -  Gemini-powered rocket analyst with persistent chat history
 */

const express = require('express');
const router = express.Router();
const GeminiService = require('../services/geminiService');
const db = require('../services/database');
const { v4: uuidv4 } = require('uuid');

let geminiService = null;
let getDataContext = null;

router.initialize = (apiKey, dataContextGetter) => {
  if (apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE') {
    geminiService = new GeminiService(apiKey);
    console.log('  [chat] Gemini chatbot initialised');
  } else {
    console.log('  [chat] No Gemini API key. Chatbot runs in fallback mode.');
  }
  getDataContext = dataContextGetter;
};

/* POST /api/chat/session  -  create a new chat session */
router.post('/session', (req, res) => {
  try {
    const sessionId = uuidv4();
    const metadata = req.body.metadata || null;
    
    db.createChatSession(sessionId, metadata);
    
    res.json({ 
      success: true, 
      sessionId,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/chat/sessions  -  list all chat sessions */
router.get('/sessions', (req, res) => {
  try {
    const sessions = db.getAllChatSessions();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* DELETE /api/chat/session/:sessionId  -  delete a chat session */
router.delete('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    db.deleteChatSession(sessionId);
    res.json({ success: true, sessionId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/chat/history/:sessionId  -  get chat history for a session */
router.get('/history/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = req.query.limit || 50;
    
    const history = db.getChatHistory(sessionId, limit);
    
    res.json({
      sessionId,
      messageCount: history.length,
      messages: history
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/chat  -  send a message (supports legacy and session-based) */
router.post('/', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    
    const actualSessionId = sessionId || 'default';
    const ctx = getDataContext ? getDataContext() : {};
    
    // Persist user message
    db.addChatMessage(actualSessionId, 'User', message);
    
    if (!geminiService) return res.json(fallback(message, ctx, actualSessionId));
    
    const response = await geminiService.chat(
      message, 
      ctx.stats, 
      ctx.summary,
      actualSessionId
    );
    
    // Persist assistant response
    db.addChatMessage(actualSessionId, 'Assistant', response.text || '', response.chartRequest || null);
    
    res.json({
      ...response,
      sessionId: actualSessionId
    });
  } catch (e) { 
    res.status(500).json({ 
      text: `Error: ${e.message}`, 
      chartRequest: null,
      persistedToDB: false
    }); 
  }
});

/* POST /api/chat/reset  -  clear chat history for a session */
router.post('/reset', (req, res) => { 
  try {
    const { sessionId } = req.body;
    const actualSessionId = sessionId || 'default';
    
    if (geminiService) {
      geminiService.resetChat(actualSessionId);
    }
    
    res.json({ 
      success: true,
      sessionId: actualSessionId,
      message: 'Chat history cleared'
    }); 
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function fallback(msg, ctx, sessionId = 'default') {
  const m = msg.toLowerCase();
  const s = ctx.summary;

  if (m.includes('anomal') || m.includes('issue') || m.includes('problem')) {
    if (s) {
      const text = `## Anomaly Summary\n\nDetected **${s.totalAnomalies} anomalies** in **${s.totalEvents} events**.\n\n**By Severity:**\n- CRITICAL: ${s.bySeverity.CRITICAL}\n- WARNING: ${s.bySeverity.WARNING}\n- CAUTION: ${s.bySeverity.CAUTION}\n\n**By Type:**\n${Object.entries(s.byType).map(([k,v])=>`- ${k}: ${v}`).join('\n')}\n\n**Most Affected:**\n${Object.entries(s.byParameter).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`- ${k}: ${v}`).join('\n')}\n\n> Connect your Gemini API key for full AI analysis.`;
      db.addChatMessage(sessionId, 'Assistant', text);
      return { text, chartRequest: null, sessionId, persistedToDB: true };
    }
  }
  if (m.includes('velocity') || m.includes('speed')) {
    const text = '## Velocity Profile\n\nDisplaying velocity over mission time:';
    const chartRequest = { type:'line', params:['velocity_ms'], title:'Velocity', highlightAnomalies:true };
    db.addChatMessage(sessionId, 'Assistant', text, chartRequest);
    return { text, chartRequest, sessionId, persistedToDB: true };
  }
  if (m.includes('altitude') || m.includes('height')) {
    const text = '## Altitude Profile\n\nDisplaying altitude over mission time:';
    const chartRequest = { type:'line', params:['altitude_km'], title:'Altitude', highlightAnomalies:true };
    db.addChatMessage(sessionId, 'Assistant', text, chartRequest);
    return { text, chartRequest, sessionId, persistedToDB: true };
  }
  if (m.includes('pressure') || m.includes('max q') || m.includes('dynamic')) {
    const text = '## Dynamic Pressure (Q)\n\nShowing dynamic pressure profile:';
    const chartRequest = { type:'line', params:['dynamic_pressure_pa'], title:'Dynamic Pressure', highlightAnomalies:true };
    db.addChatMessage(sessionId, 'Assistant', text, chartRequest);
    return { text, chartRequest, sessionId, persistedToDB: true };
  }
  if (m.includes('accel')) {
    const text = '## Acceleration Profile\n\nDisplaying acceleration:';
    const chartRequest = { type:'line', params:['acceleration_ms2'], title:'Acceleration', highlightAnomalies:true };
    db.addChatMessage(sessionId, 'Assistant', text, chartRequest);
    return { text, chartRequest, sessionId, persistedToDB: true };
  }
  if (m.includes('angle') || m.includes('pitch') || m.includes('gravity turn')) {
    const text = '## Flight Angle\n\nShowing pitch angle over time:';
    const chartRequest = { type:'line', params:['angle_deg'], title:'Flight Angle', highlightAnomalies:true };
    db.addChatMessage(sessionId, 'Assistant', text, chartRequest);
    return { text, chartRequest, sessionId, persistedToDB: true };
  }
  if (m.includes('overview') || m.includes('summary') || m.includes('hello') || m.includes('hi')) {
    const text = `## SpaceX CRS-16 Telemetry Analysis\n\nWelcome. I am your flight data analyst.\n\n${s ? `**Dataset:** ${ctx.data?.length||0} samples\n**Anomalies:** ${s.totalAnomalies} (${s.totalEvents} events)\n**Critical:** ${s.bySeverity.CRITICAL}` : 'Load data to begin.'}\n\nAsk me about:\n- "Show anomalies"\n- "Analyse velocity profile"\n- "What happened at Max Q?"\n- "Show acceleration"\n\n> Add your Gemini API key in .env for full AI analysis.`;
    db.addChatMessage(sessionId, 'Assistant', text);
    return { text, chartRequest: null, sessionId, persistedToDB: true };
  }
  const text = 'I can help analyse SpaceX CRS-16 telemetry. Try asking about:\n- **Anomalies** - "Show all anomalies"\n- **Velocity** - "Analyse velocity"\n- **Altitude** - "Show altitude profile"\n- **Dynamic Pressure** - "Show Max Q"\n- **Acceleration** - "Check acceleration"\n- **Overview** - "Give me a summary"\n\n> Add your Gemini API key to .env for full analysis.';
  db.addChatMessage(sessionId, 'Assistant', text);
  return { text, chartRequest: null, sessionId, persistedToDB: true };
}

module.exports = router;
