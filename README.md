# FamilyCut

Find the bills you can cut. Keep the money your family needs.

FamilyCut helps a US family find recurring expenses worth reviewing, decide **Keep / Cut / Negotiate**, see the annual
effect in dollars, and get a ready-to-send cancellation email or negotiation script. No bank connection and no sign-up.
Built for Business Cup 2.0 (Money Track). English (US), USD.

- **Live demo:** https://familycut.vercel.app (press **Try demo**, no signup)
- **Repository:** https://github.com/nurasss/familycut
- **Try demo:** open the app and press **Try demo**. It loads the fictional "Miller family" (clearly labelled *Sample data*) and walks
  the whole path: results → action plan → **Copy**. It works without any API key. Replacing a saved real audit or family goal requires confirmation; Cancel preserves it.

## Run locally

```bash
npm i
cp .env.example .env.local   # optional — see below
npm run dev                  # http://localhost:3000
```

`.env.local` is optional. Without it the app works fully; action texts come from built-in templates (tagged **Template** in the UI).

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | Optional. Enables AI-written action texts (xAI Grok). Server-side only. |
| `XAI_MODEL` | Optional. Defaults to `grok-4-1-fast-non-reasoning`. |

Scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Playwright smoke tests against a production build on port 3210 (see note below) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

E2E note: tests use your installed **Google Chrome** by default (Playwright's bundled Chromium is not available on some OS versions).
To use the bundled browser instead: `npx playwright install chromium && PW_CHANNEL= npm run test:e2e`. The e2e build goes to
`.next-e2e` and does not interfere with `npm run dev`.

## Architecture

```
manual / paste / CSV  ──►  parse + column mapping  ──►  normalize merchant  ──►  detect recurrence
        (browser)              src/lib/engine/parse.ts      normalize.ts              detect.ts
                                                                                          │
                                         money (integer cents)  ◄──  zustand store  ◄─────┘
                                         engine/money.ts            store.ts (localStorage)
                                                  │
                                    UI: /  /audit  /results  /action
                                                  │
                                   buildSafeActionRequest() → allowlisted merchant or "Service provider"
                                  { merchant, action, frequency, currentPriceCents, target?, tone }
                                                  ▼
                                    POST /api/ai/action  ──►  Grok (optional)  ──►  validated JSON
                                                                    └─ any failure ──►  local template
```

- **Client-only parsing and math.** CSV/paste parsing, merchant normalization, recurrence detection, manual **Split** / **Merge** row grouping, and all money arithmetic run
  in the browser as pure TypeScript functions with integer cents (no floats for money). In the import preview you can manually
  map a separate **Debit column** alongside **Amount / Credit** (for split Paid/Received or Debit/Credit statements),
  **Edit**, **Exclude**, or **Restore** individual rows, select active debit charges to **Split** or **Merge** (confirming >1.5x price jumps when prompted), and confirm before replacing an existing saved audit.
- **The server has exactly one route:** `POST /api/ai/action`. The client builds requests with `buildSafeActionRequest`
  (`src/lib/ai/safe-request.ts`), mapping recognized services to their canonical name and replacing unrecognized names with
  `"Service provider"` (omitting `targetPriceCents` on `cut`), while keeping the original merchant name locally for page headings
  and personalized local templates. The route validates with Zod, rate-limits (20 requests/min per IP, in memory), re-applies
  the allowlist policy server-side before asking Grok, and validates the response schema. The UI displays a personalized local
  template immediately while requesting optional AI polish in the background (with a client-side deadline under 9 s). On a missing
  key, timeout, HTTP error, `source: "fallback"` response, or invalid output, the personalized local template remains usable.
- **Recovery:** persisted data is validated at runtime; valid expenses survive partial corruption, malformed expenses/fields are discarded or reset, and stored keys cannot overwrite store actions. This does not encrypt or back up your data.
- **State:** a zustand store persisted in `localStorage` (`familycut:audit:v1`). Raw CSV files, imported preview rows, row source indices, manual group assignments, and price-change confirmations are kept in memory only and never persisted or sent to the server; normalized `Expense` items and decisions are stored locally until deleted. Bank transaction IDs from your CSV are used in memory for de-duplication only and are never written to `localStorage`.

Key files: [`docs/CONTRACT.md`](docs/CONTRACT.md) (types, functions, store actions), [`docs/TZ.md`](docs/TZ.md) (specification).

## Privacy

What goes to the server and what does not (from the spec, §9.1 and §11.2):

> Your CSV and pasted rows are processed in your browser. Raw transactions are not uploaded to our server. Saved audits stay on this device until you delete them. When generating an action draft, `buildSafeActionRequest` sends only minimal summary fields of one selected expense to `/api/ai/action` (`merchant` restricted to canonical allowlisted names or `"Service provider"`).

```
BROWSER
  manual / paste / CSV → parse → column mapping → normalize merchant → detect recurrence
  → compute money → render results → save audit locally
  → buildSafeActionRequest() → send { merchant (allowlist | "Service provider"), action, frequency, currentPriceCents, target?, tone } ONLY
SERVER API (/api/ai/action)
  validate minimal payload → re-apply allowlist policy → LLM (optional) → validate schema → return script or fallback
```

- **AI action requests:** Only the sanitized fields of one expense (`merchant` canonicalized from the allowlist or `"Service provider"`, `action`, `frequency`, `currentPriceCents`, optional `targetPriceCents` on `negotiate`, `tone`) are included in `POST /api/ai/action` and forwarded to the model. Nothing is logged by the route, and `XAI_API_KEY` lives only in server env.
- **Unneeded CSV columns** (account number, owner name, balance…) are ignored at parsing time.
- **Action URL IDs:** Navigating to `/action?id=...` and reloading sends a browser `GET` request carrying the local `Expense.id`. New imported expenses use random opaque IDs; manual expenses use UUIDs, and legacy revealing IDs are migrated. These IDs identify local records and do not grant access to a saved audit. Old URLs can remain in browser history (see Known limitations).
- A Playwright test (NFR-04) asserts that the demo path sends nothing except `POST /api/ai/action` with minimal allowed keys, and contacts no other origin.
- Security headers (CSP, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies) are set in `next.config.ts`.

## Three separate numbers

The results screen never mixes these (spec §8.2):

| Metric | Meaning |
|---|---|
| **Recurring spend / year** | Annual equivalent of recurring payments that you confirmed (Keep/Cut/Negotiate) or that were detected with enough confidence. |
| **Potential annual savings (estimate)** | Only from the Cut and Negotiate choices **you** made. Cut = the full annual cost; Negotiate = `(current − target) × periods per year`, and **only if you entered a target price**. No default discounts. |
| **Self-reported annual savings (not bank-verified)** | Only for actions you marked **completed**, with the new price you reported (Cut = $0). Never negative. |

*Potential* is a plan; *reported* is what you say you achieved. Neither is verified against a bank.
Formulas: `annual = price × {weekly 52, monthly 12, quarterly 4, yearly 1}`.

## Tests

Unit tests (`npm test`, Vitest) cover: **T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10 (fallback), T-12, T-15, T-16**, merchant
normalization, parsing (BOM, `, ; \t`, date and amount formats, line numbers), the full demo CSV through parse → detect, a 1 000-row
performance check (< 500 ms), the Grok client (mocked: retry, timeout, schema) and the rate limiter.

E2E tests (`npm run test:e2e`, Playwright, production build, no API key): **T-14** (demo to Copy with $1,769.52 / $725.76 / $0.00 / 48%),
**T-10** (AI endpoint returns 500 → "Template" text still shown), **T-11** (Delete my data → reload → empty), **T-13** (no horizontal scroll at 375 and 360 px on `/`, `/audit`, `/results`, `/action`), the Paste scenario (**T-01**), NFR-04 (network payload),
security headers, a clean-console / fonts-load check, ten-entry manual editing/reload, demo replacement confirmation, exact-cent manual input, and `e2e/manual-grouping.spec.ts` (Split/Merge calculations, confirmation dialogs, stale confirmation resets, privacy/persistence, mobile overflow/ID uniqueness, and Replace audit behavior).

Not covered (P1 in the spec): T-17, T-18, T-19.

## Known limitations

- `localStorage` is **not encrypted**; anyone using the same browser profile can read a saved audit. Use **Delete my data** on shared devices.
- URLs recorded in browser history or server logs before opaque-ID migration may contain old merchant slugs; the app cannot erase those records. Old action links stop resolving after migration and show **Expense not found**.
- The rate limiter lives in the memory of a single server instance. On several instances (or serverless cold starts) the limit is per instance.
- Detection is rule-based heuristics: it can miss subscriptions or flag false ones. Every finding shows its reason and confidence, and nothing is decided for you.
- Supported input: manual entry, pasted text and UTF-8 CSV (≤ 5 MB, ≤ 10 000 rows). No PDF statements, no Windows-1251.
- Manual row editing, excluding, restoring, and **Split** / **Merge** grouping apply to CSV/paste preview rows prior to analysis; manual grouping assignments are not persisted after moving to `/results`, and changing recurring group composition after analysis requires re-importing.
- USD and English only. No accounts and no cross-device sync; no sharing or two-statement family duplicate check (P1 in the spec). Basic browser print (`Print / Save as PDF`) prints the current filtered view, while a dedicated full-audit PDF report export is P1.
- AI text may be imperfect. The system prompt instructs the model not to invent phone numbers, links, or refund rights and responses are schema-validated, but AI outputs can still contain mistakes—always review the message and contact the provider yourself.

## Submission materials

The [10-slide PDF pitch](docs/submission/familycut-pitch.pdf), [five-minute speaker script](docs/submission/speaker-script.md), [60–90 second demo script](docs/submission/demo-script.md), and [submission checklist](docs/submission/submission-checklist.md) are in `docs/submission/`. Business-model prices are hypotheses; payments are not implemented. Local validation does not prove the public deployment contains the latest changes.

## Deploy

Vercel (no env needed for a working app):

1. Push the repository to GitHub and **Import Project** in Vercel (framework: Next.js, defaults are fine).
2. Optional, for AI-written texts: add `XAI_API_KEY` and (optionally) `XAI_MODEL` under *Project → Settings → Environment Variables*, then redeploy.
3. Open the deployment URL, press **Try demo**, and put the URL at the top of this README.

Self-hosting: `npm ci && npm run build && npm start` (Node 20+). Serve it behind HTTPS.

## Disclaimer

Not financial or legal advice. Review details before acting. FamilyCut does not cancel anything for you and does not verify savings with your bank.
Sample data is fictional.
