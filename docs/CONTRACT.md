# FamilyCut — контракт backend ↔ frontend

Источник правды по бизнес-логике: `docs/TZ.md`. Все деньги — **целые центы USD**. Форматировать только через `formatUsd`.

## Структура папок

```
src/app/                 FRONTEND (кроме api/): страницы /, /audit, /results (сейчас заглушки)
src/app/api/ai/action/   BACKEND: POST /api/ai/action
src/components/          FRONTEND
src/lib/                 BACKEND
  types.ts               общие типы
  schemas.ts             Zod-схемы API
  format.ts              formatUsd
  store.ts               zustand-стор (persist)
  engine/                parse, normalize, detect, money (+ тесты)
  ai/fallback.ts         шаблоны без LLM
  fixtures/miller.ts     демо-данные
```

## Владение файлами

- **Backend:** `src/lib/**`, `src/app/api/**`, тесты, конфиги (`package.json`, `tsconfig`, `vitest.config.mts`, `next.config.ts`), `docs/CONTRACT.md`.
- **Frontend:** `src/app/**` (кроме `api`), `src/components/**`, `src/app/globals.css`.

## Типы (`@/lib/types`)

| Тип | Описание |
|---|---|
| `Frequency` | `weekly\|monthly\|quarterly\|yearly\|unknown` |
| `Decision` | `undecided\|keep\|cut\|negotiate\|not_recurring` |
| `ActionStatus` | `not_started\|attempted\|completed` |
| `Confidence` | `high\|medium\|low\|manual` |
| `SystemFlag` | `duplicate_candidate\|price_increase\|trial_ending_unknown\|review_price\|unclear_merchant` |
| `Transaction` | нормализованная операция (в store не сохраняется) |
| `Expense` | регулярный расход; поле `flags: SystemFlag[]` |
| `FamilyGoal` | `{ name, targetCents }` |
| `AuditSession` | `{ version: 1, id, createdAt, updatedAt, expenses, goal? }` |
| `ActionRequest` / `ActionResponse` | тело и ответ `POST /api/ai/action` (§10.2) |
| `Totals` | `recurringAnnualCents, potentialAnnualCents, reportedAnnualCents, plannedGoalPct, reportedGoalPct` |
| `RawRow` | `Record<string,string>` — строка CSV по заголовкам |
| `ColumnMapping` | `{ date, description, amount, debitColumn?, transactionId?, signConvention }` |
| `ParseResult` | `{ rows: Transaction[], errors: { line, reason }[] }` |

## Zod (`@/lib/schemas`)

- `actionRequestSchema` — merchant 1..80, `action: cut|negotiate`, `tone: polite|firm`, цены — целые центы ≥ 0.
- `actionResponseSchema` — валидация ответа ИИ.
- `frequencySchema`.

## Функции

| Функция | Модуль | Статус | Описание |
|---|---|---|---|
| `MULTIPLIER` | `engine/money` | готово | `{weekly:52, monthly:12, quarterly:4, yearly:1, unknown:0}` |
| `annualCents(priceCents, freq)` | `engine/money` | готово | годовой эквивалент |
| `computeTotals(expenses, goal?)` | `engine/money` | готово | три метрики + % цели (§8) |
| `formatUsd(cents)` | `format` | готово | `"$1,234.56"` |
| `fallbackAction(req)` | `ai/fallback` | готово | шаблон письма/скрипта (§10.4), `source: 'fallback'` |
| `parseCsv(text)` | `engine/parse` | заглушка | CSV → `RawRow[]` |
| `parsePaste(text)` | `engine/parse` | заглушка | вставленный текст → `RawRow[]` |
| `applyMapping(rows, mapping)` | `engine/parse` | заглушка | `RawRow[]` → `ParseResult` |
| `normalizeMerchant(raw)` | `engine/normalize` | заглушка | `NETFLIX.COM 8844` → `Netflix` |
| `detectRecurring(txs)` | `engine/detect` | заглушка | `Transaction[]` → `Expense[]` |

Заглушки бросают `Error('not implemented')` до следующего этапа.

## Store (`@/lib/store`)

`useAuditStore` — zustand + persist, localStorage ключ `familycut:audit:v1` (в `STORAGE_KEY`). Хранит только `session` и `isDemo`; сырые транзакции не сохраняются.

State: `session: AuditSession | null`, `isDemo: boolean`.

| Action | Описание |
|---|---|
| `startSession(expenses, { isDemo })` | новая сессия с заданными расходами |
| `loadDemo()` | сессия из `DEMO_EXPENSES` + `DEMO_GOAL`, `isDemo = true` |
| `addExpense(input: NewExpense): string` | добавить расход (нужны merchant, priceCents, frequency; остальное по умолчанию), создаёт сессию при отсутствии; возвращает id |
| `updateExpense(id, patch)` | частичное обновление расхода |
| `removeExpense(id)` | удалить расход |
| `setDecision(id, decision)` | Keep/Cut/Negotiate/Not recurring |
| `setTargetPrice(id, cents \| undefined)` | целевая цена для Negotiate |
| `setActionStatus(id, status, reportedNewPriceCents?)` | статус действия; `completedAt`/`reportedNewPriceCents` ставятся только при `completed` (для Cut цена = 0, если не передана) |
| `setGoal(goal \| undefined)` | семейная цель |
| `deleteAllData()` | полностью чистит store и localStorage |

Селектор `useTotals(): Totals` — `computeTotals` по текущей сессии (мемоизирован).

Заметка по SSR: store читает localStorage на клиенте синхронно; компоненты, зависящие от `session`, лучше рендерить после mount (иначе hydration mismatch).

## Фикстуры (`@/lib/fixtures/miller`) — «Sample data»

- `DEMO_EXPENSES` — 5 позиций из §15.1 (итог potential = 72576 ¢).
- `DEMO_GOAL` — `Family trip`, 150000 ¢ (≈48%).
- `DEMO_TRANSACTIONS_CSV` — 28 строк `Date,Description,Amount,Transaction ID` за авг–окт 2026: шумные названия, 1 refund, 1 дубль ID (`TX-1005`), grocery, годовой платёж $120, 2 входящие выплаты.
- `SAMPLE_DATA_LABEL` — `'Sample data'` (обязательная метка в UI).

## API

`POST /api/ai/action` — вход `ActionRequest`, выход `ActionResponse`. Сейчас всегда `source: 'fallback'`. Ошибки: `400 { error: 'invalid_json' | 'invalid_request' }`. Интеграция Grok — следующий этап; контракт ответа не изменится.

## Правила для UI

- Три показателя (recurring / potential / reported) показывать раздельно, не складывать.
- Reported — только «self-reported, not bank-verified».
- Negotiate без `targetPriceCents` → экономия 0, скрипт доступен.
- Тексты на английском (US), USD.
