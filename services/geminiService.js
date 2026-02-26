/**
 * Google Gemini AI Service - with persistent chat history
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');

class GeminiService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    this.chatHistory = []; // In-memory fallback
  }

  _buildContext(telemetryStats, anomalySummary) {
    return `You are an expert aerospace engineer and flight data analyst AI assistant embedded in a Rocket Data Logger & Analyzer application. You analyze SpaceX Falcon 9 CRS-16 launch telemetry and help engineers understand anomalies and flight behaviour.

CURRENT DATASET:
- Source: SpaceX CRS-16 mission (Falcon 9 Block 5, ISS resupply)
- Orbit: ISS  |  Landing: RTLS  |  Payload: 2573 kg
- Sample rate: 1 Hz  |  Duration: ~528 seconds
- Parameters: velocity (m/s), altitude (km), vertical/horizontal velocity, acceleration (m/s2),
  downrange distance (km), flight angle (deg), dynamic pressure Q (Pa),
  jerk (m/s3), altitude rate, velocity rate, angle rate, Mach number

KEY MISSION EVENTS:
- Throttle-down: T+48 s to T+68 s
- Max Q: T+54 s
- MECO: T+145 s
- SES-1 (Stage 2 ignition): T+156 s

ANOMALY SUMMARY:
${JSON.stringify(anomalySummary, null, 2)}

STATISTICS:
${JSON.stringify(telemetryStats, null, 2)}

RULES:
1. Answer questions about this flight data, anomalies, and vehicle behaviour.
2. Use proper aerospace terminology and SI units.
3. When asked to visualise, return a JSON chart config inside <chart> tags:
   <chart>{"type":"line","params":["velocity_ms"],"timeRange":[0,150],"title":"Velocity","highlightAnomalies":true}</chart>
4. Reference anomaly event IDs (EVT-XXX) when relevant.
5. Always provide a comprehensive text response alongside any chart requests.
6. Be concise and technical.`;
  }

  /**
   * Get or load chat history from database
   */
  _getSessionHistory(sessionId) {
    try {
      return db.getChatHistory(sessionId, 50);
    } catch (error) {
      console.error('  [gemini] Error loading chat history:', error.message);
      return [];
    }
  }

  /**
   * Save message to database
   */
  _saveToDB(sessionId, role, content, chartRequest = null) {
    try {
      db.addChatMessage(sessionId, role, content, chartRequest);
    } catch (error) {
      console.error('  [gemini] Error saving message to database:', error.message);
    }
  }

  /**
   * Chat with context - persists to database
   */
  async chat(message, telemetryStats, anomalySummary, sessionId = 'default') {
    try {
      const ctx = this._buildContext(telemetryStats, anomalySummary);
      
      // Load conversation history from database
      const sessionHistory = this._getSessionHistory(sessionId);
      const historyText = sessionHistory
        .map(h => `${h.role}: ${h.content}`)
        .join('\n');

      const prompt = `${ctx}\n\nHISTORY:\n${historyText}\n\nUSER: ${message}\n\nRespond technically with a comprehensive text response. If the user asks for a chart include a <chart>{...}</chart> JSON block. Always provide both detailed analysis text AND the chart request (if applicable).`;

      const result = await this.model.generateContent(prompt);
      const response = result.response.text();

      // Save user message to database
      this._saveToDB(sessionId, 'User', message);

      // Parse chart from response
      const chartMatch = response.match(/<chart>([\s\S]*?)<\/chart>/);
      let chartRequest = null;
      let cleanResponse = response;
      
      if (chartMatch) {
        try { 
          chartRequest = JSON.parse(chartMatch[1]);
        } catch (_) {
          console.warn('  [gemini] Failed to parse chart JSON');
        }
        cleanResponse = response.replace(/<chart>[\s\S]*?<\/chart>/, '').trim();
      }

      // Save assistant message with chart to database
      this._saveToDB(sessionId, 'Assistant', cleanResponse, chartRequest);

      return { 
        text: cleanResponse, 
        chartRequest,
        sessionId,
        persistedToDB: true
      };
    } catch (error) {
      console.error('Gemini API Error:', error.message);
      return { 
        text: `AI Service Error: ${error.message}. Check your GEMINI_API_KEY.`, 
        chartRequest: null,
        sessionId,
        persistedToDB: false
      };
    }
  }

  /**
   * Reset chat history in database
   */
  resetChat(sessionId = 'default') {
    try {
      db.clearChatHistory(sessionId);
      console.log(`  [gemini] Chat history cleared for session: ${sessionId}`);
      return true;
    } catch (error) {
      console.error('  [gemini] Error resetting chat:', error.message);
      return false;
    }
  }

  /**
   * Get chat history for a session
   */
  getHistory(sessionId = 'default') {
    return this._getSessionHistory(sessionId);
  }
}

module.exports = GeminiService;
