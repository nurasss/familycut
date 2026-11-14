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

Все чистые, без сети; работают в браузере.

| Функция | Модуль | Описание |
|---|---|---|
| `MULTIPLIER`, `annualCents(priceCents, freq)` | `engine/money` | множители §8.1, годовой эквивалент |
| `computeTotals(expenses, goal?)` | `engine/money` | три метрики + % цели. **recurring** = не `not_recurring`, frequency ≠ unknown и (decision keep/cut/negotiate **или** confidence ≠ low). **reported** никогда < 0 |
| `formatUsd(cents)` | `format` | `"$1,234.56"` |
| `parseCsv(text): RawRow[]` | `engine/parse` | Papa Parse, BOM, авто-разделитель `, ; \t`. **Бросает `Error` с читаемым текстом** при файле > 5 МБ или > 10 000 строк / без заголовка |
| `parsePaste(text): RawRow[]` | `engine/parse` | вставка: CSV с заголовком или строки `2026-10-03 NETFLIX.COM 8844 -15.49` → колонки `Date/Description/Amount`. Непонятные строки остаются с пустыми Date/Amount и попадут в `errors` |
| `suggestMapping(headers): ColumnMapping \| null` | `engine/parse` | эвристика по названиям колонок; `null`, если date/description/amount не найдены (тогда UI просит выбрать вручную) |
| `applyMapping(rows, mapping): ParseResult` | `engine/parse` | `rows: Transaction[]`, `errors: {line, index, reason}[]`. **`line`** — номер строки так, как его видит пользователь: вставка без заголовка — 1-based по вставленному тексту (пустые строки считаются), CSV/вставка с заголовком — заголовок = 1, первая строка данных = 2. **`index`** — 0-based позиция в массиве `rows`, переданном в `applyMapping` (UI должен искать строку по `index`, а не по `line - 2`). Причины: `Missing date`, `Invalid date`, `Missing description`, `Missing amount`, `Invalid amount`, `Zero amount`. Битые строки не ломают импорт |
| `parseDate(s)`, `parseAmountCents(s)` | `engine/parse` | хелперы (`YYYY-MM-DD`/`MM/DD/YYYY`; `$1,234.56`, `(15.49)`, `-15.49`) |
| `normalizeMerchant(raw)` | `engine/normalize` | `NETFLIX.COM 8844` → `Netflix` |
| `analyzeTransactions(txs)` | `engine/detect` | `{ expenses: Expense[], stats: { parsed, excludedRefunds, excludedDuplicates, credits } }` — основной вызов для `/audit` |
| `detectRecurring(txs): Expense[]` | `engine/detect` | `analyzeTransactions(txs).expenses` |
| `pickReviewCandidates(expenses, n=3): Expense[]` | `engine/detect` | топ 3–5 (n зажат в 3..5) для Review: undecided, известная частота, не «магазин», не low, с флагами или ≥ $100/год. Возвращает **копии** с первой строкой в `reasons` вида `Worth a review: …`; ничего не меняет и не ставит Cut |
| `categorize(merchant)`, `isRegularStore(merchant)` | `engine/detect` | категории: Entertainment, Health & fitness, Utilities, Software, Groceries, Other |
| `fallbackAction(req)` | `ai/fallback` | локальный шаблон (§10.4), зависит от `tone`; `source: 'fallback'` |

### Соглашение о знаке `Transaction.amountCents`

- `> 0` — списание (расход);
- `< 0` и `isRefund: true` — возврат (в расходы не входит);
- `< 0` и `isRefund: false` — входящий кредит (зарплата и т.п.), не расход.

`Transaction.id` = банковский Transaction ID, если колонка выбрана и заполнена, иначе `row-<line>` (такой id считается «ID нет»).

### Что находит `detectRecurring`

- Дедуп: одинаковые date+merchant+amount+**реальный** transaction ID → одна запись (`stats.excludedDuplicates`). Без ID не удаляем, а ставим флаг `duplicate_candidate`.
- Refund и входящие в суммы не попадают.
- Частота по интервалам (недели 6–8, месяц 27–34, квартал 88–95, год 355–375 дней), цена = последняя; смена цены → reason `Price changed from $X to $Y`, при росте флаг `price_increase`.
- Confidence: monthly 3+ → high, 2 → medium; weekly 2 → low, 3 → medium, 4+ → high; quarterly/yearly 2 → medium. Нестабильные суммы понижают уровень.
- Одиночные списания попадают в список **только** если мерчант похож на подписку (категория/слова ANNUAL, MEMBERSHIP…): `confidence: 'low'`, частота `yearly`/`monthly` только если слово есть в описании, иначе `unknown`.
- Магазины/рестораны: максимум `low` + reason `Regular store purchases — not a subscription`.
- `Expense.id` детерминированный: `exp-<merchant-slug>-<priceCents>`.

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
- `DEMO_TRANSACTIONS_CSV` — 28 строк (проходит `parseCsv → suggestMapping → applyMapping → analyzeTransactions`) `Date,Description,Amount,Transaction ID` за авг–окт 2026: шумные названия, 1 refund, 1 дубль ID (`TX-1005`), grocery, годовой платёж $120, 2 входящие выплаты.
- `SAMPLE_DATA_LABEL` — `'Sample data'` (обязательная метка в UI).

## API

`POST /api/ai/action` — вход `ActionRequest`, выход `ActionResponse`.

- Grok (xAI, `https://api.x.ai/v1/chat/completions`, structured output `json_schema`) → `source: 'ai'`. Любой сбой (нет `XAI_API_KEY`, HTTP-ошибка, таймаут 8 с, невалидный ответ после 1 retry) → локальный шаблон, `source: 'fallback'`. HTTP-статус всегда 200 при валидном запросе, так что UI всегда получает текст.
- В модель уходят только поля `ActionRequest`. Тексты и суммы не логируются.
- Ошибки: `400 { error: 'invalid_json' | 'invalid_request' }`, `429 { error: 'rate_limited' }` + `Retry-After` (20 запросов/мин на IP, in-memory).
- Env: `XAI_API_KEY`, `XAI_MODEL` (по умолчанию `grok-4-1-fast-non-reasoning`).

## Правила для UI

- Три показателя (recurring / potential / reported) показывать раздельно, не складывать.
- Reported — только «self-reported, not bank-verified».
- Negotiate без `targetPriceCents` → экономия 0, скрипт доступен.
- Тексты на английском (US), USD.
