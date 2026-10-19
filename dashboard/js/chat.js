/**
 * chat.js
 * ---------------------------------------------------------------------
 * The Assistant page (chat.html): a full-page chat in the style of
 * Claude/ChatGPT — a welcome screen with suggested questions, then a
 * conversation thread with a composer pinned to the bottom.
 *
 * UI ONLY for now: replies come from `streamAssistantReply` below, which
 * fakes a streamed answer. Swap its body for a call to your backend —
 * everything else (streaming, stop, retry-free history) already works.
 *
 * iPhone notes: the page is sized to the *visual* viewport, so the
 * composer stays above the on-screen keyboard (iOS Safari doesn't
 * resize the layout for it).
 * ---------------------------------------------------------------------
 */

const CHAT_STORAGE_KEY = 'ledger-chat';

const chat = {
  messages: [],      // [{ role: 'user' | 'assistant', content: string }]
  controller: null,  // AbortController while a reply is streaming
};

// ============================================================
// BACKEND
// ============================================================

/**
 * Streams the assistant's reply to `history` (the full conversation,
 * ending with the user's latest message), yielding text chunks.
 * Honour `signal` so the Stop button can cancel the request.
 *
 * BACKEND: replace the placeholder below with your API, e.g. a
 * streaming fetch to a Supabase Edge Function:
 *
 *   const { data: { session } } = await supabaseClient.auth.getSession();
 *   const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
 *     method: 'POST',
 *     signal,
 *     headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
 *     body: JSON.stringify({ messages: history }),
 *   });
 *   if (!res.ok) throw new Error(`Chat request failed (${res.status})`);
 *   const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
 *   for (;;) {
 *     const { value, done } = await reader.read();
 *     if (done) return;
 *     yield value;
 *   }
 */
async function* streamAssistantReply(history, signal) {
  const reply = "I'm not connected to the backend yet, so I can't look at your transactions just yet.\n\n"
    + 'Once I am, I\'ll be able to help with things like:\n'
    + '- **Spending breakdowns** by category, user or account\n'
    + '- **Budget and forecast** questions for the current month\n'
    + '- **Comparisons** with previous months';
  await sleep(600, signal);
  for (const word of reply.split(/(?<=\s)/)) {
    await sleep(18, signal);
    yield word;
  }
}

/** Resolves after `ms`, or rejects with an AbortError if `signal` fires first. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// ============================================================
// RENDERING
// ============================================================

/** The Ledger monogram (gold ring, serif L): the assistant's avatar, like a letterhead. */
const MONOGRAM = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <circle cx="32" cy="32" r="30.5" stroke="var(--gold)" stroke-width="2.4"/>
  <path transform="translate(20.527 46.412) scale(0.021008 -0.021008)" fill="currentColor" d="M572 1387 485 1374Q466.5 1371.5 457.25 1365.25Q448 1359 448 1347V58Q448 36.5 460.5 27.25Q473 18 497 18H716Q764 18 806.25 36.0Q848.5 54 889.5 101.0Q930.5 148 973.5 236L1064 422Q1066.5 426.5 1068.75 428.75Q1071 431 1074 430Q1078 429.5 1079.0 425.75Q1080 422 1078 415L986 -8Q983 -21 981.25 -24.5Q979.5 -28 977 -28Q970.5 -28 957.75 -21.0Q945 -14 924.25 -7.0Q903.5 0 872 0H79Q74.5 0 72.25 2.0Q70 4 70 6Q70 11.5 81 13L168 26Q187 29 196.0 35.0Q205 41 205 53V1347Q205 1359 196.0 1365.25Q187 1371.5 168 1374L81 1387Q70 1388.5 70 1394Q70 1396.5 72.25 1398.25Q74.5 1400 79 1400H574Q578.5 1400 580.75 1398.25Q583 1396.5 583 1394Q583 1388.5 572 1387Z"/>
</svg>`;

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markdown: **bold**, *italic*, `code`. Input is already HTML-escaped. */
const inlineMarkdown = (text) => text
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

/** A figure-like table cell ("£1,234.56", "−12%", "42"), set right-aligned. */
const isFigure = (cell) => /^[−\-+]?£?[\d,]+(\.\d+)?%?$/.test(cell.trim());

/** A markdown table ("| a | b |" rows, with a |---| divider after the header) as HTML. */
function renderTable(lines) {
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const [head, , ...rows] = lines;
  const body = rows.map(cells);
  // A column of figures is right-aligned, header included.
  const figureColumn = cells(head).map((_, i) => body.length > 0 && body.every((r) => !r[i] || isFigure(r[i])));
  const cell = (tag, c, i) => `<${tag}${figureColumn[i] ? ' class="is-figure"' : ''}>${inlineMarkdown(c)}</${tag}>`;
  return `<table><thead><tr>${cells(head).map((c, i) => cell('th', c, i)).join('')}</tr></thead>`
    + `<tbody>${body.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('')}</tbody></table>`;
}

/**
 * A small, safe markdown renderer for replies: paragraphs, bullet and
 * numbered lists, tables, headings and inline styles. Everything is escaped first.
 */
function renderMarkdown(source) {
  const blocks = escapeHtml(source.trim()).split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.length >= 2 && lines.every((l) => /^\s*\|/.test(l)) && /^[\s|:-]+$/.test(lines[1])) {
      return renderTable(lines);
    }
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inlineMarkdown(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      return `<ol>${lines.map((l) => `<li>${inlineMarkdown(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    }
    // A paragraph followed directly by a list (no blank line between).
    const listStart = lines.findIndex((l) => /^\s*[-*•]\s+/.test(l));
    if (listStart > 0 && lines.slice(listStart).every((l) => /^\s*[-*•]\s+/.test(l))) {
      return `<p>${inlineMarkdown(lines.slice(0, listStart).join('<br>'))}</p>`
        + `<ul>${lines.slice(listStart).map((l) => `<li>${inlineMarkdown(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    const heading = block.match(/^#{1,3}\s+(.+)$/);
    if (heading && lines.length === 1) return `<h3>${inlineMarkdown(heading[1])}</h3>`;
    return `<p>${inlineMarkdown(lines.join('<br>'))}</p>`;
  }).join('');
}

/** Builds one message element. Assistant messages get an avatar and a copy action. */
function messageElement(role, content) {
  const el = document.createElement('div');
  el.className = `msg msg--${role}`;
  if (role === 'user') {
    el.innerHTML = '<div class="msg__bubble"></div>';
    el.querySelector('.msg__bubble').textContent = content;
  } else {
    el.innerHTML = `
      <span class="msg__avatar" aria-hidden="true">${MONOGRAM}</span>
      <div class="msg__body">
        <div class="msg__content"></div>
        <div class="msg__actions">
          <button type="button" class="msg__action" data-copy title="Copy">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.7"/>
              <path d="M15.5 5.5v-.5A1.5 1.5 0 0 0 14 3.5H6A1.5 1.5 0 0 0 4.5 5v8A1.5 1.5 0 0 0 6 14.5h.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
            <span>Copy</span>
          </button>
        </div>
      </div>`;
    el.querySelector('.msg__content').innerHTML = renderMarkdown(content);
  }
  return el;
}

// ============================================================
// PAGE
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  fitToVisualViewport();

  const session = await authReady;
  if (!session) return; // auth.js is already redirecting to login.html

  initUserMenu(session);
  document.getElementById('signout-button').addEventListener('click', signOut);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  initChatPage(session);
});

function initChatPage(session) {
  const scroller = document.getElementById('chat-scroll');
  const thread = document.getElementById('chat-thread');
  const welcome = document.getElementById('chat-welcome');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const newChat = document.getElementById('chat-new');
  const touch = window.matchMedia('(pointer: coarse)').matches;

  // ---- Greeting ----
  document.getElementById('chat-greeting').textContent = greeting(session) || 'What would you like to know?';
  initPageHeading(session); // the gold date line above the greeting

  // ---- Scrolling: follow new content unless the reader has scrolled up ----
  let pinned = true;
  scroller.addEventListener('scroll', () => {
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }, { passive: true });
  const scrollToEnd = (force) => { if (force || pinned) scroller.scrollTop = scroller.scrollHeight; };

  // ---- Composer ----
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  };
  const updateSend = () => {
    const generating = Boolean(chat.controller);
    send.classList.toggle('is-stop', generating);
    send.setAttribute('aria-label', generating ? 'Stop generating' : 'Send message');
    send.disabled = !generating && !input.value.trim();
  };
  input.addEventListener('input', () => { autosize(); updateSend(); });
  input.addEventListener('keydown', (event) => {
    // Desktop: Enter sends, Shift+Enter adds a line. Phones: Return adds a line; tap the button to send.
    if (event.key === 'Enter' && !event.shiftKey && !touch && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (chat.controller) { chat.controller.abort(); return; } // the button is "Stop" while streaming
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autosize();
    if (touch) input.blur(); // drop the keyboard so the reply is visible
    ask(text);
  });

  document.getElementById('chat-suggestions').addEventListener('click', (event) => {
    const button = event.target.closest('.chat__suggestion');
    if (button) ask([...button.children].map((part) => part.textContent.trim()).join(' '));
  });

  newChat.addEventListener('click', () => {
    chat.controller?.abort();
    chat.messages = [];
    save();
    renderThread();
    input.focus();
  });

  thread.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-copy]');
    if (!copy) return;
    const index = [...thread.querySelectorAll('.msg--assistant')].indexOf(copy.closest('.msg'));
    const message = chat.messages.filter((m) => m.role === 'assistant')[index];
    try {
      await navigator.clipboard.writeText(message.content);
      copy.querySelector('span').textContent = 'Copied';
      setTimeout(() => { copy.querySelector('span').textContent = 'Copy'; }, 1500);
    } catch { /* clipboard unavailable */ }
  });

  // ---- Conversation ----
  function renderThread() {
    thread.innerHTML = '';
    chat.messages.forEach((m) => thread.appendChild(messageElement(m.role, m.content)));
    const empty = chat.messages.length === 0;
    welcome.hidden = !empty;
    newChat.hidden = empty;
    document.body.classList.toggle('chat-has-messages', !empty);
    updateSend();
    scrollToEnd(true);
  }

  async function ask(text) {
    chat.messages.push({ role: 'user', content: text });
    save();
    renderThread();

    const reply = { role: 'assistant', content: '' };
    const el = messageElement('assistant', '');
    el.classList.add('is-streaming');
    el.querySelector('.msg__content').innerHTML = '<span class="msg__thinking"><span></span><span></span><span></span></span>';
    thread.appendChild(el);
    scrollToEnd(true);

    chat.controller = new AbortController();
    updateSend();
    try {
      const history = chat.messages.slice();
      for await (const chunk of streamAssistantReply(history, chat.controller.signal)) {
        reply.content += chunk;
        el.querySelector('.msg__content').innerHTML = renderMarkdown(reply.content);
        scrollToEnd();
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[Ledger chat] Reply failed:', error);
        reply.content += `${reply.content ? '\n\n' : ''}*Sorry — something went wrong. Please try again.*`;
        el.querySelector('.msg__content').innerHTML = renderMarkdown(reply.content);
      }
    } finally {
      chat.controller = null;
      el.classList.remove('is-streaming');
      if (reply.content) {
        chat.messages.push(reply);
        save();
      } else {
        el.remove(); // stopped before any text arrived
      }
      updateSend();
    }
  }

  function save() {
    try { sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chat.messages)); } catch { /* storage unavailable */ }
  }

  // Restore this tab's conversation (kept for the browser session only).
  try { chat.messages = JSON.parse(sessionStorage.getItem(CHAT_STORAGE_KEY)) || []; } catch { chat.messages = []; }
  renderThread();
  if (!touch) input.focus();
}

/**
 * Sizes the page to the visual viewport. iOS Safari doesn't shrink the
 * layout when the keyboard opens, so without this the composer would sit
 * behind it. Also flags `keyboard-open` (trims the composer's home-bar padding).
 */
function fitToVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
    document.body.classList.toggle('keyboard-open', window.innerHeight - vv.height > 120);
    // iOS scrolls the page to reveal the focused field; keep it pinned so the top bar stays put.
    if (vv.offsetTop > 0) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
