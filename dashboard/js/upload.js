/**
 * upload.js
 * ---------------------------------------------------------------------
 * The "Upload statement" dialog. Pick a bank, one of that bank's
 * accounts, the statement month (last/this/next month) and a file; it's
 * uploaded to the `spending-tracker` Supabase Storage bucket at
 *
 *   data/transactions/raw/<User>/<Bank>/<AccountID>/<Month-YY>/<file name>
 *   e.g. data/transactions/raw/Taj/Amex/123456/September-26/statement.pdf
 *
 * <User> is the account's owner (from the accounts table), not whoever
 * is uploading. Uploading a file with the same name into the same
 * folder overwrites it. The upload details (bank, account_id, month,
 * uploaded_by, original_filename) are stored on the object's metadata.
 * ---------------------------------------------------------------------
 */

const STATEMENTS_BUCKET = 'spending-tracker';
const STATEMENTS_PREFIX = 'data/transactions/raw';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = ['pdf', 'csv'];
// Fixed English names so the folder never depends on the browser's locale.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

/**
 * Storage path for a statement, e.g.
 * 'data/transactions/raw/Taj/Amex/123456/September-26/statement.pdf'.
 */
function statementPath(account, monthKey, fileName) {
  // Keeps each part a single, storage-safe path segment.
  const safe = (value) => String(value).trim().replace(/[^A-Za-z0-9._-]+/g, '_');
  return [
    STATEMENTS_PREFIX,
    safe(account.groupLabel),
    safe(account.bank),
    safe(account.id),
    statementMonthFolder(monthKey),
    safe(fileName),
  ].join('/');
}

/** Wires up the upload button, the dialog's dropdowns and submitting the form. */
function initStatementUpload() {
  const openBtn = document.getElementById('upload-open');
  const dialog = document.getElementById('upload-dialog');
  const form = document.getElementById('upload-form');
  const bankSelect = document.getElementById('upload-bank');
  const accountSelect = document.getElementById('upload-account');
  const monthSelect = document.getElementById('upload-month');
  const fileInput = document.getElementById('upload-file');
  const filePicker = document.getElementById('upload-filepicker');
  const fileName = document.getElementById('upload-file-name');
  const fileClear = document.getElementById('upload-file-clear');
  const status = document.getElementById('upload-status');
  const submitBtn = document.getElementById('upload-submit');

  const refreshFilePicker = () => {
    const file = fileInput.files[0];
    filePicker.classList.toggle('upload-filepicker--filled', !!file);
    fileName.textContent = file ? file.name : 'Choose file…';
    fileClear.hidden = !file;
  };
  fileInput.addEventListener('change', refreshFilePicker);
  fileClear.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.value = '';
    refreshFilePicker();
  });

  const banks = [...new Set(ACCOUNTS.map((a) => a.bank))].sort();
  bankSelect.replaceChildren(...banks.map((bank) => new Option(bank, bank)));

  const fillAccounts = () => {
    const accounts = ACCOUNTS.filter((a) => a.bank === bankSelect.value);
    accountSelect.replaceChildren(...accounts.map((a) => new Option(`${a.id} · ${a.groupLabel}`, a.id)));
  };
  bankSelect.addEventListener('change', fillAccounts);
  fillAccounts();

  const monthKeys = uploadMonthKeys();
  monthSelect.replaceChildren(...monthKeys.map((key) => new Option(MONTH_LABEL(key), key)));
  monthSelect.value = monthKeys[0]; // statements usually arrive for the month just ended

  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `upload-status${kind ? ` upload-status--${kind}` : ''}`;
  };

  openBtn.addEventListener('click', () => {
    setStatus('');
    dialog.showModal();
  });
  document.getElementById('upload-cancel').addEventListener('click', () => dialog.close());
  // Clicking the backdrop (outside the dialog box) closes it.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file) return setStatus('Choose a statement file first.', 'error');
    const extension = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension)) return setStatus('Only PDF or CSV statements can be uploaded.', 'error');
    if (file.size > MAX_UPLOAD_BYTES) return setStatus('That file is over 20 MB.', 'error');

    submitBtn.disabled = true;
    setStatus('Uploading…');
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const account = ACCOUNTS.find((a) => a.id === accountSelect.value && a.bank === bankSelect.value);
      const path = statementPath(account, monthSelect.value, file.name);
      const { error } = await supabaseClient.storage
        .from(STATEMENTS_BUCKET)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
          metadata: {
            bank: bankSelect.value,
            account_id: accountSelect.value,
            month: monthSelect.value,
            uploaded_by: session?.user.email,
            original_filename: file.name,
          },
        });
      if (error) throw error;
      setStatus(`Uploaded as ${path}`, 'success');
      fileInput.value = '';
      refreshFilePicker();
    } catch (err) {
      console.error('[Ledger upload] Statement upload failed:', err);
      setStatus(err.message || 'Upload failed.', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
