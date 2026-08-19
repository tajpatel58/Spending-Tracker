# Ledger — Household Spending Dashboard (Frontend)

A static, no-build-step frontend: plain HTML, CSS, and JS. Open `index.html`
in a browser (or serve the folder) and it runs entirely on mock data —
nothing to install.

```
household-ledger/
  index.html         # page shell — stat tiles, charts, table, chat popup
  css/
    styles.css        # design tokens (colors/type/spacing) + all styling
  js/
    mock-data.js       # fake transactions, shaped like future API responses
    app.js              # all rendering logic + interactivity
```

## Running it

No build step. Either:
- Open `index.html` directly in a browser, or
- Serve the project root so the dashboard can read its sibling `data/`
  directory: `python3 -m http.server 8000` from the project root, then visit
  `http://localhost:8000/dashboard/`.

## What's real vs. mock right now

- **Theme toggle** (light/dark) is fully functional and persists via
  `localStorage`.
- **Month selector, category filter chips, search, column sorting** are
  fully functional against the mock dataset in `js/mock-data.js`.
- **Account filter** loads its grouped accounts from `data/accounts/accounts.csv`.
- **Charts** (category donut + 6-month trend) render live from whatever
  month/filters are selected.
- **Chat popup** is UI-only. Sending a message shows your message, a typing
  indicator, then a static placeholder reply — no backend call is made yet.

## Wiring it up to your FastAPI backend

Every place that reads from `TRANSACTIONS` / `CATEGORIES` in `app.js` has an
`// API:` comment showing the `fetch()` call it should become. In short:

| Mock data source | Replace with |
|---|---|
| `TRANSACTIONS[month]` | `GET /api/transactions?month=YYYY-MM` |
| `categoryTotals(txs)` in `renderStats` / `renderCategoryChart` | `GET /api/analytics/summary?month=YYYY-MM` |
| `MONTHS.map(m => monthTotal(m.key))` in `renderTrendChart` | `GET /api/analytics/trend?months=6` |
| Chat stub in `initChat` | `POST /api/chat` with `{ message, history }` |

Suggested order:
1. Get `GET /api/transactions` returning real (or sandboxed) data in the
   same shape as the mock objects: `{ id, date, merchant, category, amount }`.
2. Swap `getMonthTransactions()` in `app.js` to `await fetch(...)` and make
   the render functions `async`.
3. Add the two analytics endpoints once the raw transactions round-trip
   correctly — or just keep computing totals client-side from the raw
   transactions if your data volume stays small (a household's monthly
   transactions is a tiny payload either way).
4. Wire the chat form's stub to `POST /api/chat`, which should run your
   Claude tool-use loop server-side and return `{ reply: "..." }`.

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
