/**
 * upload.js
 * ---------------------------------------------------------------------
 * The Upload page (upload.html). Pick a bank, one of that bank's
 * accounts, the statement month (last/this/next month) and a file; it's
 * uploaded to the `spending-tracker` Supabase Storage bucket at
 *
 *   data/transactions/raw/<User>/<Bank>/<AccountID>/<Month-YY>/statement.<ext>
 *   e.g. data/transactions/raw/Taj/Amex/123456/September-26/statement.csv
 *
 * <User> is the account's owner (from the accounts table), not whoever
 * is uploading. The file is always saved as statement.<ext>, whatever
 * its original name, so a new upload for the same account and month
 * replaces the previous one. The upload details (bank, account_id,
 * month, uploaded_by, original_filename) are stored on the object's
 * metadata.
 *
 * To catch pipeline errors before they happen, a chosen file is checked
 * against what the pipeline expects for that bank (STATEMENT_FORMATS,
 * mirroring data_processing/statements.py and each bank's loader): the
 * file type, the CSV's column headings, and whether its dates fall in
 * the chosen month. The wrong file type or an oversized file stops the
 * upload; anything else is a warning and it can still go ahead ("Upload
 * anyway").
 *
 * The Statements card lists every account with whether a statement is
 * already saved for the chosen month.
 * ---------------------------------------------------------------------
 */

const STATEMENTS_BUCKET = 'spending-tracker';
const STATEMENTS_PREFIX = 'data/transactions/raw';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const LAST_ACCOUNT_KEY = 'ledger-upload-account';
// Fixed English names so the folder never depends on the browser's locale.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Accounts that never get their own statement, so they aren't offered here.
 * Radhika's Amex card is on the joint account, so its transactions come
 * through on Taj's Amex statement.
 */
const NO_STATEMENT_ACCOUNTS = ['51016'];

/** Storage folder names for banks whose display name differs from the folder. */
const BANK_FOLDERS = {
  'Chase Bank': 'Chase',
};

/**
 * What the pipeline reads for each bank (keyed by storage folder). Keep in
 * step with _BANK_TO_EXT_MAPPING and the load_raw_*_statement_csv functions:
 * `headerLine` is pandas' `skiprows`, `columns` its `usecols`.
 */
const STATEMENT_FORMATS = {
  Amex: { ext: 'csv', headerLine: 0, columns: ['Date', 'Description', 'Card Member', 'Account #', 'Amount'] },
  Chase: { ext: 'csv', headerLine: 1, columns: ['Date', 'Time', 'Transaction Type', 'Transaction Description', 'Amount', 'Balance'] },
  Nationwide: { ext: 'csv', headerLine: 3, columns: ['Date', 'Transaction type', 'Description', 'Paid out', 'Paid in', 'Balance'] },
};

const bankFolder = (bank) => BANK_FOLDERS[bank] ?? bank;
const statementFormat = (bank) => STATEMENT_FORMATS[bankFolder(bank)] || { ext: null };

/** Month keys ('YYYY-MM') for last month, this month and next month. */
function uploadMonthKeys(today = new Date()) {
  return [-1, 0, 1].map((offset) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

/** Formats a month key like '2026-09' as the folder name 'September-26'. */
function statementMonthFolder(key) {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[Number(m) - 1]}-${y.slice(2)}`;
}

/** Keeps each part a single, storage-safe path segment. */
const safeSegment = (value) => String(value).trim().replace(/[^A-Za-z0-9._-]+/g, '_');

/** Storage folder for an account's statement, e.g. 'data/transactions/raw/Taj/Amex/123456/September-26'. */
function statementFolder(account, monthKey) {
  return [
    STATEMENTS_PREFIX,
    safeSegment(account.groupLabel),
    safeSegment(bankFolder(account.bank)),
    safeSegment(account.id),
    statementMonthFolder(monthKey),
  ].join('/');
}

/** Storage path for a statement, e.g. '…/Taj/Amex/123456/September-26/statement.csv'. */
function statementPath(account, monthKey, fileName) {
  return `${statementFolder(account, monthKey)}/${safeSegment(fileName)}`;
}

const fileExtension = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Escapes text for use inside HTML, attributes included. */
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shortDate = (time) => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// ---------- Checking a CSV against the bank's format ----------

/** Splits one CSV line into cells (handles quoted cells with commas). */
function csvCells(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Reads a date cell as 'YYYY-MM' — "05/09/2026" (UK), "05 Sep 2026" or "2026-09-05". */
function cellMonth(text) {
  let m = text.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (m) return `${m[1]}-${m[2]}`;
  m = text.match(/^\d{1,2}[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${m[1].padStart(2, '0')}`;
  m = text.match(/^\d{1,2}[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})/);
  const month = m && SHORT_MONTHS.indexOf(m[1].toLowerCase());
  if (m && month >= 0) return `${m[2]}-${String(month + 1).padStart(2, '0')}`;
  return null;
}

/**
 * Reads the file the way the pipeline will and lists anything that would
 * trip it up. Returns { rows, months: {'YYYY-MM': count}, issues: [{tone, text}] }.
 */
async function inspectStatement(file, bank, monthKey) {
  const format = statementFormat(bank);
  const ext = fileExtension(file.name);
  const issues = [];
  const result = { rows: 0, months: {}, issues };

  if (format.ext && ext !== format.ext) {
    issues.push({ tone: 'error', block: true, text: `${bankFolder(bank)} statements need to be ${format.ext.toUpperCase()} files — this is ${ext ? ext.toUpperCase() : 'a file without an extension'}.` });
    return result;
  }
  if (!['csv', 'pdf'].includes(ext)) {
    issues.push({ tone: 'error', block: true, text: 'Only CSV or PDF statements can be uploaded.' });
    return result;
  }
  if (ext !== 'csv' || !format.columns) return result;

  const text = (await file.text()).replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  // pandas skips `headerLine` lines, then blank ones, and reads the headings.
  let at = format.headerLine;
  while (at < lines.length && !lines[at].trim()) at += 1;
  const headings = csvCells(lines[at] || '');
  const missing = format.columns.filter((col) => !headings.includes(col));
  if (missing.length) {
    issues.push({ tone: 'error', text: `Doesn't match the ${bankFolder(bank)} export format — missing the ${missing.map((c) => `“${c}”`).join(', ')} column${missing.length > 1 ? 's' : ''}.` });
    return result;
  }

  const dateCol = headings.indexOf('Date');
  lines.slice(at + 1).forEach((line) => {
    if (!line.trim()) return;
    result.rows += 1;
    const month = cellMonth(csvCells(line)[dateCol] || '');
    if (month) result.months[month] = (result.months[month] || 0) + 1;
  });

  if (!result.rows) {
    issues.push({ tone: 'warn', text: 'No transactions found in this file.' });
  } else {
    const inMonth = result.months[monthKey] || 0;
    const [busiest] = Object.entries(result.months).sort((a, b) => b[1] - a[1]);
    if (!inMonth && busiest) {
      issues.push({ tone: 'warn', text: `Its transactions are from ${MONTH_LABEL(busiest[0])}, not ${MONTH_LABEL(monthKey)} — check the month.` });
    }
  }
  return result;
}

/** "18 KB · 42 transactions" for the chosen file. */
function describeFile(file, inspection) {
  const parts = [fileSize(file.size)];
  if (inspection?.rows) parts.push(`${inspection.rows} transaction${inspection.rows === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

// ---------- The page ----------

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  const session = await authReady;
  if (!session) return; // auth.js is already redirecting to login.html

  initUserMenu(session);
  document.getElementById('signout-button').addEventListener('click', signOut);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  try {
    await accountsReady;
    initUploadPage(session);
    motion.reveal();
  } catch (error) {
    console.error('[Ledger upload] Failed to load accounts:', error);
    showToast({ message: "Couldn't load your accounts — try reloading", tone: 'error' });
  }
});

function initUploadPage(session) {
  const $ = (id) => document.getElementById(id);
  const form = $('upload-form');
  const bankGroup = $('upload-bank');
  const accountGroup = $('upload-account');
  const monthGroup = $('upload-month');
  const dropzone = $('upload-dropzone');
  const fileInput = $('upload-file');
  const fileCard = $('upload-file-card');
  const checks = $('upload-checks');
  const submit = $('upload-submit');
  const submitLabel = $('upload-submit-label');

  // Accounts that need a statement each month.
  const uploadAccounts = ACCOUNTS.filter((a) => !NO_STATEMENT_ACCOUNTS.includes(String(a.id)));
  const accountKey = (a) => `${a.bank}|${a.id}`;
  const banks = [...new Set(uploadAccounts.map((a) => a.bank))].sort();
  const monthKeys = uploadMonthKeys();
  const monthHints = ['Last month', 'This month', 'Next month'];

  const view = {
    bank: null,
    account: null,
    month: monthKeys[0], // statements usually arrive for the month just ended
    file: null,
    inspection: null,
    uploading: false,
    saved: {}, // 'YYYY-MM' -> { accountKey: storage object | null }, or null while loading
  };

  // Start on the account used last time, if it still exists.
  let remembered = null;
  try { remembered = localStorage.getItem(LAST_ACCOUNT_KEY); } catch { /* storage unavailable */ }
  view.account = uploadAccounts.find((a) => accountKey(a) === remembered) || uploadAccounts[0] || null;
  view.bank = view.account?.bank || banks[0];

  const choice = (name, value, checked, inner, extraClass = '') => `
    <label class="choice ${extraClass}">
      <input type="radio" name="${name}" value="${escapeHtml(value)}"${checked ? ' checked' : ''}>
      ${inner}
    </label>`;

  // ---------- Step 1: bank, account, month ----------

  function renderChoices() {
    bankGroup.innerHTML = banks.map((bank) => choice('bank', bank, bank === view.bank, `<span>${escapeHtml(bank)}</span>`)).join('');

    const saved = view.saved[view.month];
    accountGroup.innerHTML = uploadAccounts.filter((a) => a.bank === view.bank).map((a) => {
      const existing = saved?.[accountKey(a)];
      const status = !saved ? '' : existing
        ? `<span class="account-choice__status is-done">Uploaded ${shortDate(existing.updated_at || existing.created_at)}</span>`
        : '<span class="account-choice__status">Not uploaded</span>';
      return choice('account', accountKey(a), view.account && accountKey(a) === accountKey(view.account), `
        <span class="account-choice__avatar" aria-hidden="true">${escapeHtml(a.groupLabel.charAt(0))}</span>
        <span class="account-choice__text">
          <span class="account-choice__owner">${escapeHtml(a.groupLabel)}</span>
          <span class="account-choice__id">${escapeHtml(a.id)}</span>
        </span>
        ${status}`, 'account-choice');
    }).join('');

    monthGroup.innerHTML = monthKeys.map((key, i) => {
      const [y, m] = key.split('-');
      return choice('month', key, key === view.month, `
        <span class="choice__main">${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}</span>
        <span class="choice__sub">${monthHints[i]}</span>`, 'choice--stacked');
    }).join('');
  }

  bankGroup.addEventListener('change', (e) => {
    view.bank = e.target.value;
    view.account = uploadAccounts.find((a) => a.bank === view.bank) || null;
    selectionChanged();
  });
  accountGroup.addEventListener('change', (e) => {
    view.account = uploadAccounts.find((a) => accountKey(a) === e.target.value) || null;
    selectionChanged();
  });
  monthGroup.addEventListener('change', (e) => {
    view.month = e.target.value;
    selectionChanged();
    loadSaved(view.month);
  });

  /** Re-renders after the bank/account/month changes, and re-checks the chosen file. */
  function selectionChanged() {
    try { if (view.account) localStorage.setItem(LAST_ACCOUNT_KEY, accountKey(view.account)); } catch { /* ignore */ }
    renderChoices();
    renderStatements();
    renderFileHint();
    if (view.file) inspect(); else renderSummary();
  }

  // ---------- Step 2: the file ----------

  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');

  function renderFileHint() {
    const { ext } = statementFormat(view.bank);
    $('upload-hint').textContent = ext
      ? `${bankFolder(view.bank)} statements are ${ext.toUpperCase()} files · up to 20 MB`
      : 'CSV or PDF · up to 20 MB';
    fileInput.accept = ext === 'csv' ? '.csv,text/csv' : ext === 'pdf' ? '.pdf,application/pdf' : '.csv,.pdf,text/csv,application/pdf';
  }

  function setFile(file) {
    view.file = file || null;
    view.inspection = null;
    fileInput.value = '';
    dropzone.hidden = !!view.file;
    fileCard.hidden = !view.file;
    if (!view.file) { renderSummary(); return; }
    $('upload-file-name').textContent = view.file.name;
    $('upload-file-ext').textContent = (fileExtension(view.file.name) || 'file').toUpperCase().slice(0, 4);
    fileCard.classList.remove('is-in');
    void fileCard.offsetWidth;
    fileCard.classList.add('is-in');
    inspect();
  }

  let inspecting = 0;
  async function inspect() {
    const run = ++inspecting;
    const { file } = view;
    let inspection;
    if (file.size > MAX_UPLOAD_BYTES) {
      inspection = { rows: 0, issues: [{ tone: 'error', block: true, text: `That file is ${fileSize(file.size)} — the limit is 20 MB.` }] };
    } else {
      try {
        inspection = await inspectStatement(file, view.bank, view.month);
      } catch (error) {
        console.error('[Ledger upload] Could not read the file:', error);
        inspection = { rows: 0, issues: [{ tone: 'warn', text: "Couldn't read the file to check it." }] };
      }
    }
    if (run !== inspecting || file !== view.file) return; // a newer file/selection took over
    view.inspection = inspection;
    $('upload-file-meta').textContent = describeFile(file, inspection);
    renderSummary();
  }

  fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
  $('upload-file-clear').addEventListener('click', () => { setFile(null); fileInput.click(); });

  // Drag a file anywhere onto the page; the drop area lights up while you do.
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    document.body.classList.add('is-dragging-file');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('is-dragging-file');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // otherwise the browser opens the file
    dragDepth = 0;
    document.body.classList.remove('is-dragging-file');
    const [file] = e.dataTransfer.files;
    if (file && !view.uploading) setFile(file);
  });

  // ---------- Summary: checks, destination, button ----------

  function renderSummary() {
    const { file, inspection, account } = view;
    const issues = inspection?.issues || [];
    const blocked = issues.some((i) => i.block);

    const items = [];
    if (file && inspection && !issues.length) {
      const format = statementFormat(view.bank);
      items.push({ tone: 'ok', text: format.columns ? `Matches the ${bankFolder(view.bank)} export format` : 'Ready to upload' });
      if (inspection.rows && inspection.months[view.month]) {
        items.push({ tone: 'ok', text: `${inspection.months[view.month]} of ${inspection.rows} transactions are from ${MONTH_LABEL(view.month)}` });
      }
    }
    items.push(...issues);
    checks.innerHTML = items.map((item) => `
      <li class="upload-check upload-check--${item.tone}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">${item.tone === 'ok'
          ? '<path class="draw-tick" pathLength="1" d="M6 12.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
          : '<path d="M12 7.5v5.5M12 16.5h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'}</svg>
        <span>${escapeHtml(item.text)}</span>
      </li>`).join('');

    const ext = file ? fileExtension(file.name) : statementFormat(view.bank).ext || 'csv';
    $('upload-path').textContent = account
      ? statementPath(account, view.month, `statement.${ext}`).slice(STATEMENTS_PREFIX.length + 1).split('/').join(' / ')
      : '—';

    const existing = account && view.saved[view.month]?.[accountKey(account)];
    const replace = $('upload-replace');
    replace.hidden = !existing;
    if (existing) replace.textContent = `Replaces the statement uploaded ${shortDate(existing.updated_at || existing.created_at)}`;

    const warned = issues.length > 0;
    submit.disabled = view.uploading || !file || !account || !inspection || blocked;
    submit.classList.toggle('is-warned', warned && !blocked);
    submitLabel.textContent = view.uploading ? 'Uploading…' : warned && !blocked ? 'Upload anyway' : 'Upload statement';
  }

  // ---------- Statements card: what's already saved for the month ----------

  /** Looks up which accounts already have a statement saved for a month. */
  async function loadSaved(monthKey) {
    if (view.saved[monthKey] !== undefined) return;
    view.saved[monthKey] = null;
    renderStatements();
    const entries = await Promise.all(uploadAccounts.map(async (account) => {
      const { data, error } = await supabaseClient.storage.from(STATEMENTS_BUCKET).list(statementFolder(account, monthKey));
      if (error) throw error;
      const file = (data || []).filter((o) => o.name.startsWith('statement.'))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
      return [accountKey(account), file || null];
    })).catch((error) => {
      console.error('[Ledger upload] Could not list saved statements:', error);
      return 'failed';
    });
    view.saved[monthKey] = entries === 'failed' ? 'failed' : Object.fromEntries(entries);
    if (monthKey === view.month) { renderChoices(); renderStatements(); renderSummary(); }
  }

  function renderStatements() {
    const saved = view.saved[view.month];
    const list = $('statements-list');
    $('statements-title').textContent = MONTH_LABEL(view.month);
    const note = $('statements-note');

    if (saved === 'failed') {
      list.innerHTML = '';
      $('statements-count').textContent = '';
      $('statements-progress').style.width = '0';
      note.textContent = "Couldn't check which statements are saved.";
      return;
    }
    note.textContent = 'Choose an account to upload its statement.';
    const done = saved ? uploadAccounts.filter((a) => saved[accountKey(a)]).length : 0;
    $('statements-count').textContent = saved ? `${done} of ${uploadAccounts.length}` : '';
    $('statements-progress').style.width = saved ? `${(done / Math.max(1, uploadAccounts.length)) * 100}%` : '0';
    list.classList.toggle('is-loading', !saved);

    list.innerHTML = uploadAccounts.map((a) => {
      const existing = saved?.[accountKey(a)];
      const selected = view.account && accountKey(a) === accountKey(view.account);
      const status = !saved ? '<span class="statement-row__status"><span class="statement-row__skeleton"></span></span>'
        : existing
          ? `<span class="statement-row__status is-done"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>${shortDate(existing.updated_at || existing.created_at)}</span>`
          : '<span class="statement-row__status">Missing</span>';
      return `
        <li>
          <button type="button" class="statement-row${selected ? ' is-selected' : ''}" data-account="${escapeHtml(accountKey(a))}" aria-pressed="${!!selected}">
            <span class="statement-row__text">
              <span class="statement-row__bank">${escapeHtml(a.bank)}</span>
              <span class="statement-row__meta">${escapeHtml(a.groupLabel)} · ${escapeHtml(a.id)}</span>
            </span>
            ${status}
          </button>
        </li>`;
    }).join('');
  }

  $('statements-list').addEventListener('click', (e) => {
    const row = e.target.closest('.statement-row');
    if (!row) return;
    view.account = uploadAccounts.find((a) => accountKey(a) === row.dataset.account);
    view.bank = view.account.bank;
    selectionChanged();
    // On a phone the form is above this card; bring it back into view.
    if (!fine.matches) form.scrollIntoView({ behavior: motion.reduced() ? 'auto' : 'smooth', block: 'start' });
  });

  // ---------- Uploading ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { file, account, month } = view;
    if (submit.disabled || !file || !account) return;

    view.uploading = true;
    form.classList.add('is-uploading');
    renderSummary();
    const extension = fileExtension(file.name);
    const path = statementPath(account, month, `statement.${extension}`);
    try {
      const { error } = await supabaseClient.storage
        .from(STATEMENTS_BUCKET)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || (extension === 'csv' ? 'text/csv' : undefined),
          metadata: {
            bank: account.bank,
            account_id: account.id,
            month,
            uploaded_by: session.user.email,
            original_filename: file.name,
          },
        });
      if (error) throw error;

      if (view.saved[month] && view.saved[month] !== 'failed') {
        view.saved[month][accountKey(account)] = { name: `statement.${extension}`, updated_at: new Date().toISOString() };
      }
      view.uploading = false;
      form.classList.remove('is-uploading');
      setFile(null);
      renderChoices();
      renderStatements();
      showToast({ message: `${account.bank} statement for ${MONTH_LABEL(month)} uploaded` });
    } catch (error) {
      console.error('[Ledger upload] Statement upload failed:', error);
      view.uploading = false;
      form.classList.remove('is-uploading');
      renderSummary();
      showToast({ message: `Upload failed — ${error.message || 'please try again'}`, tone: 'error' });
    }
  });

  renderChoices();
  renderStatements();
  renderFileHint();
  renderSummary();
  loadSaved(view.month);
}
