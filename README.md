# FamilyCut

Find the bills you can cut. Keep the money your family needs.

FamilyCut helps a US family find recurring expenses worth reviewing, decide **Keep / Cut / Negotiate**, see the annual
effect in dollars, and get a ready-to-send cancellation email or negotiation script. No bank connection and no sign-up.
Built for Business Cup 2.0 (Money Track). English (US), USD.

- **Live demo:** https://familycut.vercel.app (press **Try demo**, no signup)
- **Repository:** https://github.com/nurasss/familycut
- **Try demo:** open the app and press **Try demo**. It loads the fictional "Miller family" (clearly labelled *Sample data*) and walks
  the whole path: results → action plan → **Copy**. It works without any API key.

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
                                  only { merchant, action, frequency, price, target, tone }
                                                  ▼
                                    POST /api/ai/action  ──►  Grok (optional)  ──►  validated JSON
                                                                    └─ any failure ──►  local template
```

- **Client-only parsing and math.** CSV/paste parsing, merchant normalization, recurrence detection and all money arithmetic run
  in the browser as pure TypeScript functions with integer cents (no floats for money).
- **The server has exactly one route:** `POST /api/ai/action`. It validates the request with Zod, rate-limits (20 requests/min per IP,
  in memory), asks Grok for a text and validates the answer. On a missing key, timeout (8 s), HTTP error or invalid output (after one
  retry) it returns a local template, so the user always gets a text.
- **State:** a zustand store persisted in `localStorage` (`familycut:audit:v1`). Raw transactions are never stored.

Key files: [`docs/CONTRACT.md`](docs/CONTRACT.md) (types, functions, store actions), [`docs/TZ.md`](docs/TZ.md) (specification).

## Privacy

What goes to the server and what does not (from the spec, §9.1 and §11.2):

> Your CSV is processed in your browser. Raw transactions are not uploaded to our server. Saved audits stay on this device until you delete them.

```
BROWSER
  manual / paste / CSV → parse → column mapping → sanitize unnecessary fields
  → normalize merchant → detect recurrence → compute money → render results
  → choose actions → save audit locally
  → send { merchant, action, frequency, price, target, tone } ONLY
SERVER API (/api/ai/action)
  validate minimal payload → LLM → validate schema → return script or fallback
NO RAW TRANSACTIONS / BANK DATA SENT TO LLM OR SERVER
```

- Only the fields of one expense reach the server and the model. Nothing is logged by the route. The API key lives only in server env.
- Unneeded CSV columns (account number, name, balance…) are ignored at parsing time.
- A Playwright test (NFR-04) asserts that the demo path sends nothing except `POST /api/ai/action` with exactly those keys, and contacts no other origin.
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
security headers, and a clean-console / fonts-load check.

Not covered (P1 in the spec): T-17, T-18, T-19.

## Known limitations

- `localStorage` is **not encrypted**; anyone using the same browser profile can read a saved audit. Use **Delete my data** on shared devices.
- The rate limiter lives in the memory of a single server instance. On several instances (or serverless cold starts) the limit is per instance.
- Detection is rule-based heuristics: it can miss subscriptions or flag false ones. Every finding shows its reason and confidence, and nothing is decided for you.
- Supported input: manual entry, pasted text and UTF-8 CSV (≤ 5 MB, ≤ 10 000 rows). No PDF statements, no Windows-1251.
- USD and English only. No accounts and no cross-device sync; no sharing, PDF export or two-statement family duplicate check (P1 in the spec).
- AI text may be imperfect. It never invents phone numbers, links or refund rights, but you must review it and contact the provider yourself.

## Deploy

Vercel (no env needed for a working app):

1. Push the repository to GitHub and **Import Project** in Vercel (framework: Next.js, defaults are fine).
2. Optional, for AI-written texts: add `XAI_API_KEY` and (optionally) `XAI_MODEL` under *Project → Settings → Environment Variables*, then redeploy.
3. Open the deployment URL, press **Try demo**, and put the URL at the top of this README.

Self-hosting: `npm ci && npm run build && npm start` (Node 20+). Serve it behind HTTPS.

## Disclaimer

Not financial or legal advice. Review details before acting. FamilyCut does not cancel anything for you and does not verify savings with your bank.
Sample data is fictional.
