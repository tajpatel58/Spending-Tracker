# Ledger — Household Spending Dashboard (Frontend)

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
