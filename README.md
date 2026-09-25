# Ledger — Household Spending Dashboard

A static, no-build-step frontend: plain HTML, CSS, and JS — no bundler, no
`npm install`. Open `index.html` in a browser (or serve the folder) and it
reads live data from Supabase.

```
household-ledger/
  index.html              # dashboard — stat tiles, charts, table, chat popup
  login.html              # Google sign-in screen, gates the dashboard
  css/
    styles.css             # design tokens (colors/type/spacing) + all styling
  js/
    config.js               # your Supabase project's URL + key (gitignored)
    config.example.js       # template for config.js
    auth.js                 # Google sign-in, the session guard, sign-out
    supabase-client.js      # connects to Supabase, reads transactions
    transactions-api.js     # writes edits (category/merchant/amount/hide) back
    data.js                 # loads categories, accounts, transactions
    format.js               # currency/date formatting helpers
    state.js                # current filters/sort + derived data
    theme.js                # light/dark mode
    stats.js                # the stat tiles
    charts.js               # the 4 charts (category, user, trend, budget)
    table.js                # the transactions table + in-place editing
    filters.js              # month/account/category/search/sort controls
    upload.js               # the "Upload statement" dialog (→ Supabase Storage)
    chat.js                 # the chat widget (UI only for now, see below)
    main.js                 # entry point — wires it all up and renders
```

The scripts are plain (non-module) files loaded in that order from
`index.html`, so later files can use functions/variables defined in earlier
ones — see the comment above the `<script>` tags in `index.html` if you move
code between files.

## Enabling it

The dashboard needs a Supabase project to read/write transactions:

1. Copy `dashboard/js/config.example.js` to `dashboard/js/config.js`.
2. Fill in your Supabase project's URL and anon key (Supabase → Project
   Settings → API). `config.js` is gitignored, so your key never gets
   committed.

### Sign-in

Google is the only sign-in method — there's no email/password fallback,
since the only users are the household. Set it up once in Supabase:

1. In Google Cloud Console, create an OAuth client ID and add
   `https://<your-project-ref>.supabase.co/auth/v1/callback` as an
   authorized redirect URI.
2. In Supabase → Authentication → Providers, enable Google and paste in
   that client ID/secret.
3. In Supabase → Authentication → URL Configuration, add the dashboard's
   `index.html` URL (e.g. `http://localhost:8000/dashboard/index.html`,
   plus whatever URL it's deployed at) to the allowed redirect URLs.
4. Restrict who can sign in from Supabase → Authentication → Policies
   (e.g. a `transactions` RLS policy keyed on `auth.uid()`/email), since
   anyone with a Google account can otherwise reach the login screen.

`login.html` and `index.html` share the same session check
(`js/auth.js`): signed-out visitors are bounced to `login.html`,
signed-in visitors are bounced away from it, and the sign-out icon in the
dashboard's top bar ends the session.

## Deploying to GitHub Pages

`.github/workflows/deploy-pages.yml` deploys the `dashboard/` folder on
every push to `main`. It generates `dashboard/js/config.js` from repo
secrets at build time, so the real Supabase key is never committed to
the repo:

1. In the repo → Settings → Secrets and variables → Actions, add
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` (same values as your local
   `config.js`).
2. In Settings → Pages, set "Build and deployment" → Source to
   **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab).
4. Once deployed, add the resulting `.../index.html` URL to Supabase →
   Authentication → URL Configuration → Redirect URLs (see "Sign-in"
   above) — Google sign-in will fail without this.

The anon key still ends up in the shipped JS (it has to, to run in the
browser) — this workflow only keeps it out of the git history. Access
control still relies on Supabase RLS/the `users` allow-list, not on
keeping the anon key secret.

## Running it

No build step. Either:
- Open `index.html` directly in a browser, or
- Serve the project root so the dashboard can read its sibling `data/`
  directory: `python3 -m http.server 8000` from the project root, then visit
  `http://localhost:8000/dashboard/`.

## What's live vs. UI-only right now

- **Theme toggle** (light/dark) is fully functional and persists via
  `localStorage`.
- **Month selector, account filter, category filter chips, search, column
  sorting** are fully functional against live Supabase data (`js/data.js`).
- **Table edits** (recategorise, rename merchant, correct amount, hide) save
  straight to Supabase via `js/transactions-api.js`.
- **Charts** (category, user, budget, 6-month trend) render live from
  whatever month/filters are selected.
- **Chat popup** is UI-only. Sending a message shows your message, a typing
  indicator, then a static placeholder reply — no backend call is made yet.
  See the `// API:` comment in `js/chat.js` for what to wire up.

## Statement uploads

The upload icon in the top bar opens a dialog. You pick a **bank**, one of
that bank's **accounts**, the **month** (last, this or next month) and a
PDF/CSV file. It's uploaded to the `spending-tracker` Supabase Storage
bucket at:

```
data/transactions/raw/<User>/<Bank>/<AccountID>/<Month-YY>/<original file name>
e.g. data/transactions/raw/Taj/Amex/123456/September-26/statement.pdf
```

`<User>` is the account's owner from the `accounts` table, not the person
uploading. Characters other than letters, digits, `.`, `_` and `-` in any
path part become `_`. Uploading a file with the same name into the same
folder overwrites it. Each object's metadata holds `bank`, `account_id`,
`month` (`YYYY-MM`), `uploaded_by` and `original_filename`.

Signed-in household members need storage policies to upload. Uploads use
`upsert`, which needs insert, select and update rights. Run this once in
the Supabase SQL editor:

```sql
create policy "Household can upload statements" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'spending-tracker' and name like 'data/transactions/raw/%'
    and exists (select 1 from public.users u where u.email = auth.jwt() ->> 'email'));

create policy "Household can read statements" on storage.objects
  for select to authenticated
  using (bucket_id = 'spending-tracker' and name like 'data/transactions/raw/%'
    and exists (select 1 from public.users u where u.email = auth.jwt() ->> 'email'));

create policy "Household can replace statements" on storage.objects
  for update to authenticated
  using (bucket_id = 'spending-tracker' and name like 'data/transactions/raw/%'
    and exists (select 1 from public.users u where u.email = auth.jwt() ->> 'email'));
```

The Python side can read files with the service-role client, which skips
these policies, e.g.
`supabase_client.storage.from_("spending-tracker").list("data/transactions/raw/Taj/Amex/123456/September-26")`
and `.download(path)`.

## Design notes

- Category colors are CSS custom properties (`--cat-groceries`, etc.) in
  `styles.css`, referenced from JS via `var(--cat-groceries)` — change a
  palette in one place and both the charts and table badges update.
- Amounts and dates use a monospaced font (IBM Plex Mono) with tabular
  figures throughout, so numbers align like a real ledger — this is the
  one deliberate "signature" detail of the design; keep it consistent if
  you extend the UI.
- Dark mode is driven by `[data-theme="dark"]` on `<html>`; all colors are
  CSS variables, so new components should always reference `var(--...)`
  rather than hardcoded hex values.
