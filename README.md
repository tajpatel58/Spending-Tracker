# Ledger — Household Spending Dashboard (Frontend)

A static, no-build-step frontend: plain HTML, CSS, and JS — no bundler, no
`npm install`. Open `index.html` in a browser (or serve the folder) and it
reads live data from Supabase.

```
household-ledger/
  index.html              # page shell — stat tiles, charts, table, chat popup
  css/
    styles.css             # design tokens (colors/type/spacing) + all styling
  js/
    config.js               # your Supabase project's URL + key (gitignored)
    config.example.js       # template for config.js
    supabase-client.js      # connects to Supabase, reads transactions
    transactions-api.js     # writes edits (category/merchant/amount/hide) back
    data.js                 # loads categories, accounts.csv, transactions
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
