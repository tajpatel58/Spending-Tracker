/**
 * chat.js
 * ---------------------------------------------------------------------
 * The "Spending assistant" chat widget. This is UI ONLY — it currently
 * just echoes a placeholder reply. To enable real answers, replace the
 * `// API:` stub below with a call to your backend, e.g.:
 *
 *   const res = await fetch('/api/chat', {
 *     method: 'POST',
 *     body: JSON.stringify({ message: text, history }),
 *   });
 * ---------------------------------------------------------------------
 */

/** Wires up opening/closing the chat panel and sending messages. */
function initChat() {
  const fab = document.getElementById('chat-fab');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const messages = document.getElementById('chat-messages');

  function open() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    input.focus();
  }
  function close() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
  }

  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden ? open() : close();
  });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !fab.contains(e.target)) close();
  });
  panel.addEventListener('click', (e) => e.stopPropagation());

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    appendMessage('user', text);
    input.value = '';

    // API: replace this stub with a call to POST /api/chat
    // const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: text, history }) });
    const typing = appendTyping();
    setTimeout(() => {
      typing.remove();
      appendMessage('assistant', 'I’m not wired up to the backend yet, so I can’t answer that just yet — but the chat UI is ready to go once /api/chat exists.');
    }, 700);
  });

  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg--${role}`;
    const p = document.createElement('p');
    p.textContent = text;
    div.appendChild(p);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function appendTyping() {
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg--assistant';
    div.innerHTML = '<span class="chat-typing"><span></span><span></span><span></span></span>';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }
}
