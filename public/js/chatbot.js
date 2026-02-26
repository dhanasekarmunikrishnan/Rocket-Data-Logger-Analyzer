/* =======================================================
   chatbot.js — Chat Module with Persistent History Sidebar
   ======================================================= */
const ChatModule = (() => {
  let chartCounter = 0;
  let currentSessionId = null;
  let sessions = [];
  let initialised = false;

  /* ──────────── Initialise ──────────── */
  async function init() {
    if (initialised) {
      renderSessionList();
      return;
    }
    await loadSessions();
    if (sessions.length > 0) {
      await switchSession(sessions[0].sessionId);
    }
    initialised = true;
  }

  /* ──────────── Session CRUD ──────────── */
  async function loadSessions() {
    try {
      const res = await fetch('/api/chat/sessions');
      const data = await res.json();
      sessions = data.sessions || [];
    } catch (e) {
      sessions = [];
    }
    renderSessionList();
  }

  function renderSessionList() {
    const list = document.getElementById('chat-sessions-list');
    if (!list) return;

    if (sessions.length === 0) {
      list.innerHTML = '<div class="chat-sessions-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.35;margin-bottom:8px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>No conversations yet.<br>Start a new chat!</div>';
      return;
    }

    list.innerHTML = sessions.map(s => {
      const active = s.sessionId === currentSessionId ? ' active' : '';
      const title = escapeHtml((s.title || 'New Chat').substring(0, 45));
      const time = formatTime(s.updatedAt);
      const count = s.messageCount || 0;
      return `<div class="chat-session-item${active}" data-id="${s.sessionId}" onclick="ChatModule.switchSession('${s.sessionId}')">
  <div class="chat-session-info">
    <div class="chat-session-title">${title}</div>
    <div class="chat-session-meta">${time} · ${count} msg${count !== 1 ? 's' : ''}</div>
  </div>
  <button class="chat-session-delete" onclick="event.stopPropagation();ChatModule.deleteSession('${s.sessionId}')" title="Delete">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
  </button>
</div>`;
    }).join('');
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  async function newChat() {
    try {
      const res = await fetch('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.sessionId) {
        currentSessionId = data.sessionId;
        clearChatArea();
        addWelcomeBubble();
        await loadSessions();
        const input = document.getElementById('chat-input');
        if (input) input.focus();
      }
    } catch (e) {
      console.error('Failed to create chat session', e);
    }
  }

  async function switchSession(sessionId) {
    if (currentSessionId === sessionId && document.getElementById('chat-messages')?.children.length > 1) {
      renderSessionList();
      return;
    }
    currentSessionId = sessionId;
    clearChatArea();
    renderSessionList();

    try {
      const res = await fetch(`/api/chat/history/${sessionId}?limit=200`);
      const data = await res.json();
      const messages = data.messages || [];

      if (messages.length === 0) {
        addWelcomeBubble();
        return;
      }

      messages.forEach(m => {
        const role = m.role === 'User' ? 'user' : 'ai';
        addBubble(role, m.content, false);
        if (m.chartRequest) renderChatChart(m.chartRequest);
      });

      const wrap = document.getElementById('chat-messages');
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    } catch (e) {
      addWelcomeBubble();
    }
  }

  async function deleteSession(sessionId) {
    if (!confirm('Delete this conversation?')) return;
    try {
      await fetch(`/api/chat/session/${sessionId}`, { method: 'DELETE' });
      if (currentSessionId === sessionId) {
        currentSessionId = null;
        clearChatArea();
      }
      await loadSessions();
      if (sessions.length > 0 && !currentSessionId) {
        await switchSession(sessions[0].sessionId);
      } else if (sessions.length === 0) {
        currentSessionId = null;
        clearChatArea();
        addWelcomeBubble();
      }
    } catch (e) {
      console.error('Failed to delete session', e);
    }
  }

  /* ──────────── Messaging ──────────── */
  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    // Auto-create session if none active
    if (!currentSessionId) {
      try {
        const res = await fetch('/api/chat/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();
        currentSessionId = data.sessionId;
      } catch (e) {
        addBubble('ai', '⚠️ Failed to create chat session.');
        return;
      }
    }

    addBubble('user', msg);
    showTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, sessionId: currentSessionId })
      });
      const data = await res.json();
      hideTyping();

      if (data.error) { addBubble('ai', '⚠️ ' + data.error); return; }
      addBubble('ai', data.text || data.response || data.message || 'No response received.');
      if (data.chartRequest) renderChatChart(data.chartRequest);

      // Refresh sidebar to show updated session
      await loadSessions();
    } catch (e) {
      hideTyping();
      addBubble('ai', '⚠️ Connection error. Please try again.');
    }
  }

  function sendSuggestion(text) {
    document.getElementById('chat-input').value = text;
    sendMessage();
  }

  /* ──────────── UI Helpers ──────────── */
  function clearChatArea() {
    const wrap = document.getElementById('chat-messages');
    if (wrap) wrap.innerHTML = '';
  }

  function addWelcomeBubble() {
    const wrap = document.getElementById('chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ai';
    div.innerHTML = `<div class="msg-avatar">AI</div><div class="msg-bubble">
      <h3>Welcome to the Rocket AI Analyst</h3>
      <p>I analyse SpaceX CRS-16 (Falcon 9) launch telemetry. Ask me about flight data, anomalies, or request visualisations.</p>
      <p><strong>Try asking:</strong></p>
      <ul>
        <li>"Give me an overview of the flight"</li>
        <li>"What anomalies were detected?"</li>
        <li>"Show the velocity profile"</li>
        <li>"What happened around Max Q?"</li>
      </ul></div>`;
    wrap.appendChild(div);
  }

  function addBubble(role, content, scroll = true) {
    const wrap = document.getElementById('chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    const avatar = role === 'ai' ? 'AI' : 'You';
    const body = role === 'ai'
      ? (typeof marked !== 'undefined' ? marked.parse(content) : content)
      : escapeHtml(content);
    div.innerHTML = `<div class="msg-avatar">${avatar}</div><div class="msg-bubble">${body}</div>`;
    wrap.appendChild(div);
    if (scroll) wrap.scrollTop = wrap.scrollHeight;
  }

  function renderChatChart(chartData) {
    chartCounter++;
    const id = 'chat-chart-' + chartCounter;
    const wrap = document.getElementById('chat-messages');
    if (!wrap) return;
    const box = document.createElement('div');
    box.className = 'chat-chart-box';
    box.innerHTML = `<div id="${id}" class="chart-area"></div>`;
    wrap.appendChild(box);
    wrap.scrollTop = wrap.scrollHeight;

    setTimeout(() => {
      if (chartData.type === 'line' || chartData.type === 'area') {
        ChartModule.createLineChart(id, chartData.labels || [], chartData.datasets || [], { xTitle: chartData.xTitle || '', yTitle: chartData.yTitle || '', hideLegend: false });
      } else if (chartData.type === 'bar') {
        ChartModule.createBarChart(id, chartData.labels || [], chartData.datasets || [], { xTitle: chartData.xTitle || '', yTitle: chartData.yTitle || '' });
      } else if (chartData.type === 'scatter') {
        ChartModule.createScatterChart(id, chartData.datasets || [], { xTitle: chartData.xTitle || '', yTitle: chartData.yTitle || '' });
      } else if (chartData.type === 'doughnut' || chartData.type === 'pie') {
        ChartModule.createDoughnutChart(id, chartData.labels || [], chartData.data || [], chartData.colors);
      }
    }, 100);
  }

  function showTyping() {
    const wrap = document.getElementById('chat-messages');
    if (!wrap) return;
    let el = document.getElementById('typing-bubble');
    if (!el) {
      el = document.createElement('div');
      el.id = 'typing-bubble';
      el.className = 'chat-msg ai';
      el.innerHTML = '<div class="msg-avatar">AI</div><div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
    }
    wrap.appendChild(el);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('typing-bubble');
    if (el) el.remove();
  }

  async function resetChat() {
    if (!currentSessionId) return;
    try {
      await fetch('/api/chat/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId })
      });
    } catch (e) {}
    clearChatArea();
    addWelcomeBubble();
    await loadSessions();
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('chat-sidebar');
    if (sidebar) sidebar.classList.toggle('collapsed');
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { init, sendMessage, sendSuggestion, resetChat, newChat, switchSession, deleteSession, loadSessions, toggleSidebar };
})();

/* Global helpers called from HTML */
function sendMessage() { ChatModule.sendMessage(); }
function sendSuggestion(t) { ChatModule.sendSuggestion(t); }
