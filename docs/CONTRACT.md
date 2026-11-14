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
  engine/                parse, normalize, detect, grouping, money, lifecycle (+ тесты)
  ai/fallback.ts         шаблоны без LLM
  ai/response-check.ts   строгая проверка ответа модели (сервер)
  ai/safe-request.ts     безопасное имя услуги для модели (browser-safe) + серверная политика
  ids.ts                 непрозрачные id расходов (browser-safe) + проверка/миграция старых id
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
| `Transaction` | нормализованная операция (в store не сохраняется); опциональный in-memory `sourceIndex?: number` для сопоставления со строкой предпросмотра (F09) |
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
| `parseCsv(text): RawRow[]` | `engine/parse` | Papa Parse, BOM, авто-разделитель `, ; \t`. **Бросает `Error` с читаемым текстом** при файле > 5 МБ или > 10 000 строк / без заголовка, а также при **незакрытых или неверно закрытых кавычках** (`MissingQuotes`/`InvalidQuotes`), в том числе **в строке заголовка** (даже если ни одна запись не прочитана): после такой кавычки границы строк неизвестны, поэтому текст ошибки — `Line N: a quoted field is never closed, …Nothing was imported…` (без содержимого файла), частичного импорта и «восстановления» нет. `TooManyFields` (непустые лишние ячейки) и `TooFewFields` сохраняются как внутренняя диагностика строки (см. `applyMapping`); пустые хвостовые ячейки (запятая в конце строки) ошибкой не считаются. Лишние ячейки в `RawRow` не попадают. Каждая строка запоминает физический номер строки, с которой начинается: переводы строки LF, CRLF и одиночный CR считаются по одному разу (CRLF не дважды), пустые строки и многострочные ячейки в кавычках учитываются. Файл только с валидным заголовком — пустой импорт `[]` |
| `parsePaste(text): RawRow[]` | `engine/parse` | вставка: CSV с заголовком или строки `2026-10-03 NETFLIX.COM 8844 -15.49` → колонки `Date/Description/Amount`. Непонятные строки остаются с пустыми Date/Amount и попадут в `errors` Для CSV с заголовком в разбор уходит **исходный текст целиком** (без построчного trim и удаления пустых строк): содержимое ячеек в кавычках, включая пустые строки внутри, и физические номера строк совпадают с `parseCsv`. Свободные строки разбираются и нумеруются по одной, как раньше |
| `suggestMapping(headers): ColumnMapping \| null` | `engine/parse` | эвристика по названиям колонок; `null`, если date/description/amount не найдены (тогда UI просит выбрать вручную) |
| `applyMapping(rows, mapping): ParseResult` | `engine/parse` | `rows: Transaction[]`, `errors: {line, index, reason}[]`. **`line`** — номер строки так, как его видит пользователь: вставка без заголовка — 1-based по вставленному тексту (пустые строки считаются), CSV/вставка с заголовком — физическая строка файла/вставки (заголовок обычно 1, первая строка данных 2). **`index`** — 0-based позиция в массиве `rows`, переданном в `applyMapping` (UI должен искать строку по `index`, а не по `line - 2`). Причины: `Missing date`, `Invalid date`, `Missing description`, `Missing amount`, `Invalid amount`, `Zero amount`, `Amount too large (max $1,000,000)`, `Too many columns (found N, expected M) — …`, `Too few columns (found N, expected M) — missing: <колонки>` (только если потеряна сопоставленная колонка), `Both Debit and Credit have an amount`. Диагностика парсера привязана к **объекту строки**: исправленная в UI строка — новый объект, поэтому её диагностика снимается; исходная строка остаётся с ошибкой. Битые строки не ломают импорт. **Отдельные Debit/Credit** (`debitColumn` задан и отличается от `amount`; `amount` — колонка Credit): обе стороны разбираются числом; пустая и `0` равноценны для неиспользуемой стороны; Debit≠0, Credit=0 → расход; Debit=0, Credit≠0 → входящий платёж/возврат; обе ≠ 0 → ошибка (приоритета Debit нет); `0/0` и `0/пусто` → `Zero amount`; пусто/пусто → `Missing amount`; текст в любой колонке → `Invalid amount`. Для единой колонки Amount обе sign conventions не менялись. Предел суммы — `MAX_AMOUNT_CENTS` = 100 000 000 ¢ ($1 000 000), как в ручном вводе и API |
| `parseDate(s)`, `parseAmountCents(s)` | `engine/parse` | хелперы (`YYYY-MM-DD`/`MM/DD/YYYY`; `$1,234.56`, `(15.49)`, `-15.49`) |
| `normalizeMerchant(raw)` | `engine/normalize` | `NETFLIX.COM 8844` → `Netflix`. Известные продукты не склеиваются: `YouTube TV` / `YouTube Music` / `YouTube Premium`, `Adobe Photoshop` / `Acrobat` / `Lightroom` / `Illustrator` / `Premiere` / `InDesign`; непонятный `GOOGLE *YOUTUBE` → `YouTube`, `ADOBE *CREATIVE CLOUD` → `Adobe` (продукт не выдумывается). **Это не фильтр персональных данных** — неизвестный текст сохраняет слова из исходной строки. `KNOWN_BRAND_NAMES` — канонические имена явных правил |
| `analyzeTransactions(txs, options?)` | `engine/detect` | `AnalyzeResult`: `{ expenses, stats, sources, groups }`. `options.newId?: () => string` — генератор id (по умолчанию случайные непрозрачные), `options.groups?: readonly GroupAssignment[]` — ручные группы F09. Без `groups` или с `groups: []` прежние `expenses`/`stats` сохраняются, `groups: []` |
| `detectRecurring(txs, options?): Expense[]` | `engine/detect` | `analyzeTransactions(txs, options).expenses` |
| `applyGroupOp(assignments, op, makeGroupId?)` | `engine/grouping` | чистая функция операций превью F09: `split`, `merge`, `confirm`, `undo`, `clear` → `GroupOpResult` (`ok: true` с новыми `assignments`, `groupId?`, `removedGroupIds` или `ok: false` с `GroupOpError`) |
| `normalizeGroupName(input)`, `MAX_GROUPS`, `MAX_GROUP_NAME_LENGTH` | `engine/grouping` | нормализация пользовательского имени группы (запрет управляющих символов C0/DEL/C1, trim + сжатие пробелов, длина 1..80 → иначе `null`), лимиты 200 групп и 80 символов |
| `newExpenseId()`, `isOpaqueExpenseId(id)`, `ensureOpaqueIds(expenses)` | `ids` | **новые экспорты.** `exp-` + 128 случайных бит; признак безопасного id (новые, uuid, id-<время>-<случайное>, id демо-данных); замена только раскрывающих id с сохранением уникальности и без других изменений |
| `pickReviewCandidates(expenses, n=3): Expense[]` | `engine/detect` | топ 3–5 (n зажат в 3..5) для Review: undecided, известная частота, не «магазин», не low, с флагами или ≥ $100/год. Возвращает **копии** с первой строкой в `reasons` вида `Worth a review: …`; ничего не меняет и не ставит Cut |
| `categorize(merchant)`, `isRegularStore(merchant)` | `engine/detect` | категории: Entertainment, Health & fitness, Utilities, Software, Groceries, Other |
| `fallbackAction(req)` | `ai/fallback` | локальный шаблон (§10.4), зависит от `tone`; `source: 'fallback'`. Negotiate — 3–6 коротких реплик (через `\n`): просьба подтвердить новую цену и все сборы/налоги, срок предложения, условия контракта до согласия; без `targetPriceCents` текущая цена по-прежнему повторяется, но новая цена и сумма экономии не придумываются. Cut — просьба об отмене и письменном подтверждении даты и остаточных платежей; firm-тон просит отменить «как только позволяют условия», не заявляет права на немедленное прекращение. Без выдуманных контактов. Результат — нормализованный `ActionResponse`: неиспользуемые поля `subject`/`body`/`callScript` равны `null`. Исходный JSON модели устроен иначе (все пять ключей — строки, неиспользуемые поля — `""`), поэтому в тестах шаблон перед проверкой валидатором переводится `null` → `""`; сам текст шаблона проходит те же проверки |
| `buildSafeActionRequest(expense, tone): ActionRequest` | `ai/safe-request` | **новый экспорт.** Тело запроса к `/api/ai/action` из локального `Expense`: только поля `ActionRequest`, `merchant` через `safeMerchantForAi`, `targetPriceCents` только для negotiate (ключа нет, если цели нет), `cut` → `cut`, любое другое решение → `negotiate`. Не читает notes/reasons/IDs, не мутирует `expense`. Без env и серверных импортов — годится для браузера |
| `safeMerchantForAi(raw): string` | `ai/safe-request` | каноническое имя из явного allowlist (`ALLOWED_MERCHANTS`; сравнение всей строки без учёта регистра/пунктуации/хвоста `.com`) или фиксированное `Service provider`. Никогда не возвращает часть входа |
| `sanitizeActionRequest(req): ActionRequest` | `ai/safe-request` | серверная политика: пересобирает запрос с безопасным `merchant`, остальные поля копируются, лишние свойства отбрасываются |
| `applyDecision`, `applyExpensePatch`, `applyActionStatus`, `resetExecution`, `sanitizeExpense` | `engine/lifecycle` | **новые экспорты.** Единая логика переходов решения/выполнения (см. «Жизненный цикл выполнения») — через неё работают все мутации store |

### Соглашение о знаке `Transaction.amountCents`

- `> 0` — списание (расход);
- `< 0` и `isRefund: true` — возврат (в расходы не входит);
- `< 0` и `isRefund: false` — входящий кредит (зарплата и т.п.), не расход.

`Transaction.id` = банковский Transaction ID, если колонка выбрана и заполнена, иначе `row-<line>` (такой id считается «ID нет»).

### Что находит `detectRecurring`

- Дедуп: одинаковые date+merchant+amount+**реальный** transaction ID → одна запись (`stats.excludedDuplicates`). Без ID не удаляем, а ставим флаг `duplicate_candidate` (причина: «possible duplicate (or two separate accounts)» — это подсказка проверить, а не утверждение о двойной оплате).
- Refund и входящие в суммы не попадают.
- **Серии внутри мерчанта (F01, W1B1).** Операции мерчанта делятся на независимые серии; результат не зависит от порядка входных строк. Два списания в один день **никогда** не попадают в одну серию (кроме точных повторов — одинаковые дата и сумма считаются одним днём с флагом `duplicate_candidate`). Частота выбирается **по всей истории**, а не по первой подошедшей паре: сначала для каждой полосы (неделя 6–8, месяц 27–34, квартал 88–95, год 355–375 дней) строятся цепочки операций с одинаковой суммой, где все интервалы лежат в одной полосе; побеждают самые длинные цепочки (при равенстве — с большим периодом), использованные операции исключаются и поиск повторяется. Поэтому две услуги в разные дни месяца (например 3-го и 10-го, разрыв 6/7/8 дней) остаются двумя monthly-сериями, а не weekly-парами. Затем оставшиеся серии и одиночные списания соединяются «конец → начало» как смена цены, если интервал подходит к их полосе (приоритет у серий с уже определённой полосой и у ближайших сумм). У шумных мерчантов (> 60 несвязанных серий) этот шаг пропускается. Остальные операции группируются по сумме (±10 %) как нерегулярные кандидаты.
- Цена = последняя. Evidence по суммам (F06): все суммы равны → `N charges of $X, ~G days apart`; колебания ≤ 1 % → диапазон `$a–$b`, без «price change»; одна ступень > 1 % → `Price changed from $X to $Y` + `Amounts seen: 2 × $15.49, then 1 × $16.49` (при росте флаг `price_increase`); скачок > 1.5× дополнительно помечается как возможная другая услуга и снижает confidence на уровень; несколько ступеней — диапазон (≤ 10 %) или `Amounts vary between charges` и снижение confidence. Допуск 10 % используется только для привязки операции к серии, не для скрытия смены цены.
- Параллельные серии одного мерчанта с общим днём списания (названия продуктов не различимы) остаются отдельными услугами: у каждой причина «Billed on the same day as another … charge … kept as a separate service, not merged» и confidence снижен на один уровень, но не ниже `medium` — чтобы сумма не выпала из recurring.
- Confidence: monthly 3+ → high, 2 → medium; weekly 2 → low, 3 → medium, 4+ → high; quarterly/yearly 2 → medium. Нестабильные суммы понижают уровень.
- Одиночные списания попадают в список **только** если мерчант похож на подписку (категория/слова ANNUAL, MEMBERSHIP…): `confidence: 'low'`, частота `yearly`/`monthly` только если слово есть в описании, иначе `unknown`.
- Магазины/рестораны: максимум `low` + reason `Regular store purchases — not a subscription`.
- **`Expense.id` непрозрачный (W1B3):** `exp-<32 hex>` из случайных 128 бит, без merchant, сумм, описаний и банковских ID. Это идентификатор локального расхода (он попадает в `/action?id=…`, историю браузера и GET при перезагрузке страницы), **не** токен доступа или шаринга. Повторный анализ тех же данных даёт другие id — старая ссылка не может указать на другой расход. Раньше id был `exp-<merchant-slug>-<priceCents>` и раскрывал часть описания выписки.
- **Остаётся неоднозначным:** если два разных продукта одного провайдера названы одинаково (`Adobe`) — они разделены, но название не уточняется, пользователь должен проверить выписку; последовательные (не параллельные) разные услуги одного мерчанта с близкими интервалами выглядят как смена тарифа (скачок > 1.5× помечается). Для ручного разделения и объединения реализован engine F09 (`engine/grouping`, `engine/detect`), но UI / `import-adapter` / E2E его ещё не вызывают.

### Ручная группировка (F09, `engine/grouping` + `engine/detect`)

- **Назначение строк по `sourceIndex`:** строки предпросмотра идентифицируются по фактическим объектам и `Transaction.sourceIndex` (не по банковскому `Transaction.id`, который может повторяться или отсутствовать). Если `sourceIndex` передан некорректно или дублируется на входных строках, engine не выбирает строку молча — группа с таким индексом отклоняется (`invalid_group`), а `sources` не содержат дублирующихся `sourceIndices`. Если у транзакций нет `sourceIndex`, расход всё равно попадает в `sources` с `sourceIndices: []` (и ручная группа на такой индекс даёт `unknown_row`).
- **Порядок фильтров:** глобальные фильтры (`excludedDuplicates` — детерминированный выбор представителя по наименьшему `sourceIndex` среди точных дублей с реальным банковским ID — `excludedRefunds`, `credits`) выполняются **до** групп. Отфильтрованные или отсутствующие индексы не попадают в активный состав группы (`ignoredRawIndices` с причиной `unknown_row` / `row_excluded`).
- **Только `applied` меняют пул:** только группы со статусом `applied` забирают свои `activeRawIndices` из автоматического пула. Статусы `needs_confirmation`, `rejected`, `inactive` не забирают строки, не теряют и не удваивают расходы.
- **Операции (`applyGroupOp`):** `split` (≥ 1 строка), `merge` (≥ 2 строки), `confirm` (требует непустой `proposalKey`), `undo`, `clear`. Новый `split`/`merge` переносит строки из предыдущей группы, удаляет опустевшие группы и `merge` с < 2 строками (`removedGroupIds`), сбрасывает `confirmed`/`confirmedFor` у затронутых выживших групп. Имена нормализуются через `normalizeGroupName` (запрет управляющих символов, trim/сжатие пробелов, 1..80 символов). Максимум 200 групп (`MAX_GROUPS`), невалидные входы дают `GroupOpError` (`no_rows`, `too_few_rows`, `too_many_rows`, `invalid_index`, `invalid_name`, `unknown_group`, `too_many_groups`, `invalid_confirmation`).
- **Режимы расчёта:**
  - `split` — изолирует активные строки в отдельный расчёт (`duplicate_candidate` между выбранными строками и внешними сериями не ставится); из группы может получиться один или несколько расходов (если внутри оказалось несколько услуг) по их собственным списаниям; 0 активных строк → `inactive` (`too_few_rows`); если сумма > `MAX_AMOUNT_CENTS` → `rejected` (`amount_too_large`); если строки не образуют расход → `applied` с информационным `no_expense` (`expenseIds: []`, строки забраны из общего пула).
  - `merge` — требует ≥ 2 активных строк (иначе `inactive` + `too_few_rows`), объединяет строки (включая разные `merchantNormalized`, без мутации входных `Transaction`, с fallback без фильтра `subscriptionish` для нетипичных фрагментов вроде `NFLX`; обычные магазины → `applied` + `no_expense` с `expenseIds: []`). Определяет непересекающиеся по датам части (пересечение дат / параллельные серии → `rejected` `overlapping_services`, разные периоды вроде monthly + yearly → `rejected` `mixed_periods`). Последовательные части дают **последнюю актуальную цену** (не сумму цен); при `k ≥ 2` частях через разрыв `confidence` не выше `'medium'`, в `reasons` добавляются `Grouped by you: N charges in K parts` и `Gap of X days between parts…`. Скачок > 1.5× через разрыв при совместимой частоте требует подтверждения (`needs_confirmation` + `GroupProposal` с `proposalKey` вида `prop-<32 hex>`, детерминированным по составу/суммам/датам/частоте/разрывам без `Expense.id`, времени и `confirmed`); после изменения суммы, даты или активного состава при тех же `rawIndices` прежнее `confirmedFor` становится недействительным.
- **Имя и `sources`:** пользовательское `name` при невалидном значении в `GroupAssignment` даёт warning `invalid_name` и откатывается к доминирующему имени активных транзакций. Имя группы **не** влияет на `categorize` и `isRegularStore`. `AnalyzeResult.sources` возвращает `ExpenseSource[]` (`{ expenseId, sourceIndices, groupId? }`), при этом каждый `sourceIndex` принадлежит не более чем одному `Expense`.
- **Граница защиты PII и store:** `GroupAssignment`, `GroupReport`, `GroupProposal`, `ExpenseSource` и `Transaction.sourceIndex` не сохраняются в `useAuditStore` (persist `familycut:audit:v1` не менялся) и не передаются в `buildSafeActionRequest` / LLM; для пользовательского `name` вне `ALLOWED_MERCHANTS` на сервер по-прежнему уходит `'Service provider'`.

### Интерфейс импорта ручной группировки

- `evaluateMappedRows(rawRows, mapping, overrides, skippedIndices, groups?)` проставляет `Transaction.sourceIndex` из исходного `rawIndex` до анализа, возвращает `sources` и `groupReports`. Принадлежность preview-строк определяется по этим данным, без обратного поиска банковского ID.
- Выбор строк и Split/Merge/Undo/Clear находятся в preview CSV/paste и существуют только в памяти вкладки. `rejected` и `needs_confirmation` блокируют Analyze; `inactive` не блокирует при наличии расходов. Подтверждение использует актуальные `proposalKey`/`requires`. Edit/Exclude/Restore сбрасывают подтверждения затронутых назначений; изменение mapping, новый импорт и Delete my data очищают группировку. После Analyze для изменения состава нужен повторный импорт.
- Перед импортным `startSession` поверх непустой реальной сессии (расходы или цель) показывается Replace audit, в том числе для sample CSV/paste. Cancel сохраняет сессию, цель и preview; Replace повторно проверяет актуальную готовность и заменяет аудит. Ручной переход к результатам и пустая/demo-сессия сохраняют прежнее поведение. Отдельная release-защита Try demo описана ниже.

## Store (`@/lib/store`)

`useAuditStore` — zustand + persist, localStorage ключ `familycut:audit:v1` (в `STORAGE_KEY`), версия записи `STORAGE_VERSION = 3`. Хранит только `session` и `isDemo`; сырые транзакции и банковские ID транзакций не сохраняются: `startSession`, `addExpense`, `updateExpense` и `loadDemo` пропускают расходы через `stripTransactionIds`, а при чтении `transactionIds` всегда `[]` (FC-SEC-02). `analyzeTransactions` по-прежнему возвращает ID в памяти для дедупликации до `startSession`.

State: `session: AuditSession | null`, `isDemo: boolean`.

| Action | Описание |
|---|---|
| `startSession(expenses, { isDemo })` | новая сессия с заданными расходами |
| `loadDemo()` | сессия из `DEMO_EXPENSES` + `DEMO_GOAL`, `isDemo = true` |
| `addExpense(input: NewExpense): string` | добавить расход (нужны merchant, priceCents, frequency; остальное по умолчанию), создаёт сессию при отсутствии; возвращает id |
| `updateExpense(id, patch)` | частичное обновление расхода через `applyExpensePatch` — те же инварианты выполнения, что у `setDecision` (см. ниже) |
| `removeExpense(id)` | удалить расход |
| `setDecision(id, decision)` | Keep/Cut/Negotiate/Not recurring. Смена решения сбрасывает `actionStatus` → `not_started`, `reportedNewPriceCents`, `completedAt`; повтор того же решения — no-op |
| `setTargetPrice(id, cents \| undefined)` | целевая цена для Negotiate; фактически сообщённый результат не меняет |
| `setActionStatus(id, status, reportedNewPriceCents?)` | статус действия; `completedAt`/`reportedNewPriceCents` ставятся только при `completed`. Store **не** подставляет 0 для Cut: без аргумента `reportedNewPriceCents` остаётся `undefined`, а `computeTotals` трактует это как $0 для Cut (UI передаёт 0 явно) |
| `setGoal(goal \| undefined)` | семейная цель |
| `deleteAllData()` | полностью чистит store и localStorage |

Селектор `useTotals(): Totals` — `computeTotals` по текущей сессии (мемоизирован).

### Жизненный цикл выполнения (F02)

Выполнение (`actionStatus`, `reportedNewPriceCents`, `completedAt`) относится к **одному конкретному действию над одной базой** (decision + исходная `priceCents` + `frequency`). Реализация — `engine/lifecycle.ts`; ею пользуются `setDecision`, `updateExpense`, `setTargetPrice`, `setActionStatus`, поэтому patch не обходит правила.

- Фактическая смена `decision`, `priceCents` или `frequency` сбрасывает выполнение: `actionStatus = not_started` (в том числе `attempted`), `reportedNewPriceCents` и `completedAt` удаляются. Пользователь подтверждает результат заново.
- Повторная запись того же значения изменением не считается: подтверждение сохраняется (повторный `setDecision` с тем же решением возвращает тот же объект).
- Смена только `targetPriceCents`, `merchant`, `category`, `notes` выполнение не затрагивает.
- **Сброс безусловный.** Поля выполнения, переданные в том же patch, что и смена decision/цены/частоты, подтверждением нового действия **не считаются** и отбрасываются (в том числе `{ ...expense, decision: 'cut', reportedNewPriceCents: 5999 }`). Новое подтверждение — отдельным последующим `setActionStatus`.
- `reportedNewPriceCents`/`completedAt` существуют только при `completed`; у completed всегда есть `completedAt`. Keep / Not recurring / undecided **не получают** attempted/completed ни через `updateExpense`, ни через `setActionStatus` (вызов с `attempted`/`completed` для них игнорируется; `not_started` допустим).
- Формулы `computeTotals` не менялись: completed Negotiate $75→$60 = $180/year reported; Cut без reported price = полная годовая сумма.
- Persisted state: **ключ `familycut:audit:v1` сохранён**, версия записи 1 → 2 → 3. Миграция v2 → v3 обнуляет `transactionIds` и сохраняет все пользовательские поля. Миграция v1 → v2 (`migratePersisted`, срабатывает при загрузке через `migrate` у persist, запись сразу пересохраняется, поэтому id стабильны после любых reload): все id, не распознанные как безопасные (старые `exp-<slug>-<cents>`, произвольные строки, дубликаты), заменяются на `exp-<32 hex>`; решения, цены, цели, статусы, заметки, цель семьи и порядок расходов не меняются. Id демо-данных, uuid и уже непрозрачные id остаются. Запись, в которой нет числового `version`, zustand считает текущей (такую persist не создаёт). При каждой загрузке применяется runtime-валидация, описанная ниже, и инварианты lifecycle: Keep / Not recurring / undecided не сохраняют attempted/completed; валидное выполнение Cut/Negotiate сохраняется. Историческую правомерность completed по сохранённому агрегату определить нельзя.
- **Граница миграции id.** Старые ссылки вида `/action?id=exp-…` после миграции больше не находят расход (id изменился) — frontend должен показать «расход не найден» и вернуть к списку. Адрес, который уже попал в историю браузера или в серверный лог до обновления, отозвать нельзя; приложение историю браузера не очищает.

Заметка по SSR: store читает localStorage на клиенте синхронно; компоненты, зависящие от `session`, лучше рендерить после mount (иначе hydration mismatch).

## Release readiness: демо, денежный ввод и восстановление состояния

- Все UI-входы Try demo используют `components/demo/use-try-demo.ts`. Непустой реальный аудит (расходы либо цель) требует **Replace with demo**. Cancel/Escape сохраняет store и несохранённый ввод страницы, возвращая фокус на кнопку. Пустая и demo-сессия загружают пример сразу. Прямой store-action `loadDemo()` остаётся операцией замены; подтверждение обеспечивает UI.
- `components/money-input.ts` разбирает целые доллары и до двух цифр центов целочисленно; форматирование также не использует `toFixed`. Сохраняются прежние форматы (`15`, `15.`, `15.4`, `$1,234.50`); `.50`, отрицательные значения и более двух знаков отклоняются. Предел — 100 000 000 ¢.
- `lib/persisted-state.ts` валидирует неизвестный persisted input и пересобирает `session`/`isDemo` по allowlist. Persisted actions и посторонние ключи не участвуют в merge. Невалидная session становится `null`; повреждённые расходы отбрасываются по отдельности, валидные сохраняются.
- Обязательные поля расхода: непустые id (≤200), merchant (≤500), целая цена 0…100 000 000 ¢. Невалидные enum получают безопасные значения unknown/undecided/not_started/low; category — Other. Неизвестные flags и нестроковые элементы reasons/transactionIds удаляются. Невалидные optional prices/notes/timestamps опускаются.
- Лимиты восстановления: 10 000 расходов, 200 строк в reasons/transactionIds (≤1000 символов каждая), notes ≤10 000. Goal требует непустое имя ≤200 и целую положительную цель ≤100 000 000 ¢. Невалидная цель удаляется без удаления расходов. В v2 повторный id оставляет первый расход; v0/v1 сначала сохраняет записи, затем назначает уникальные opaque id.
- Временные поля проверяются как ISO/date-parseable строки; недостающие даты session восстанавливаются из другой валидной даты или текущего времени. Completed actionable расход без валидной даты получает session.updatedAt. Это восстановление метаданных, а не банковское подтверждение.
- Ключ и версии сохранения не изменились. Runtime-валидация не шифрует localStorage и не восстанавливает отброшенные повреждённые данные.

## Фикстуры (`@/lib/fixtures/miller`) — «Sample data»

- `DEMO_EXPENSES` — 5 позиций из §15.1 (итог potential = 72576 ¢).
- `DEMO_GOAL` — `Family trip`, 150000 ¢ (≈48%).
- `DEMO_TRANSACTIONS_CSV` — 28 строк (проходит `parseCsv → suggestMapping → applyMapping → analyzeTransactions`) `Date,Description,Amount,Transaction ID` за авг–окт 2026: шумные названия, 1 refund, 1 дубль ID (`TX-1005`), grocery, годовой платёж $120, 2 входящие выплаты.
- `SAMPLE_DATA_LABEL` — `'Sample data'` (обязательная метка в UI).

## API

`POST /api/ai/action` — вход `ActionRequest`, выход `ActionResponse`.

- Grok (xAI, `https://api.x.ai/v1/chat/completions`, structured output `json_schema`) → `source: 'ai'`. Любой сбой (нет `XAI_API_KEY`, HTTP-ошибка, общий таймаут 8 с на обе попытки, невалидный ответ после 1 retry) → локальный шаблон, `source: 'fallback'`. HTTP-статус всегда 200 при валидном запросе, так что UI всегда получает текст.
- В модель уходят только поля `ActionRequest`, причём **`merchant` сервер пересобирает независимо от клиента** (`sanitizeActionRequest` в `route.ts` и ещё раз в `generateWithGrok`, прямо перед `fetch`): каноническое имя из allowlist или `Service provider`. Исходное значение не попадает в prompt, retry и логи; лишние поля тела отбрасываются схемой. Локальный fallback (в сторонний сервис не уходит) использует имя, присланное клиентом. Тексты и суммы не логируются.
- **Строгая проверка ответа модели (F11, `ai/response-check.ts`).** Структура проверяется по исходному JSON модели, ничего не приводится: ключи `subject`, `body`, `callScript` — строки (неиспользуемое поле — пустая строка `""`; после проверки оно становится `null` в `ActionResponse`), `steps`/`limitations` — массивы строк (`steps: 42`, `limitations: "invalid"`, `null`, пропущенный ключ → отказ → retry → fallback). Cut: обязателен непустой `body`, `callScript` пуст; Negotiate: обязателен `callScript` из 3–6 непустых строк, `subject`/`body` пусты. `steps` 1–6, `limitations` 1–5, без пустых элементов, лимиты длины публичной схемы. Тексты со ссылками, адресами сайтов, e-mail и телефонами отклоняются **эвристической** проверкой (проверенных контактов у нас нет): схемы и `www.`, домены с известным TLD (`example.xyz`, `co.uk`), домены с путём (`example.ru/help`), три и более метки (`support.example.co.uk`), e-mail, телефонные форматы. Исключения — только суммы в `$…`, даты и четыре согласованных заполнителя `[Account email]`, `[Billing date]`, `[Customer service channel]`, `[Your name]`; произвольные скобки (`[https://…]`, `[1-800-…]`) контакты не скрывают. Это **не гарантия**: обфускации («support at example dot com»), числа прописью, нестандартные разделители и редкие TLD могут пройти; двухбуквенные коды стран, совпадающие со словами (`it`, `in`, `me`…), без схемы/пути не считаются доменом. Каждая сумма в долларах должна совпадать с `currentPriceCents` или `targetPriceCents` запроса (без цели — только текущая): придуманные цены и «экономия» отклоняются. Это проверка структуры и перечисленных признаков, а **не** гарантия юридической или фактической корректности текста — пользователь проверяет письмо сам. Один retry и общий deadline 8 с сохранены.
- **Граница защиты PII (F03).** Сервер → LLM защищён (политика на сервере повторяется независимо от клиента). Frontend строит тело запроса через `buildSafeActionRequest`, устаревшее `merchant.slice(0, 80)` больше не используется: неизвестное имя уходит на сервер как `Service provider`, известное — каноническим названием, исходное имя остаётся только локально. Allowlist — единственный механизм: произвольный результат `normalizeMerchant` или regex не считаются безопасными. Если пользователю нужно имя услуги в готовом письме, оно подставляется локально, а не моделью.
- Ошибки: `400 { error: 'invalid_json' | 'invalid_request' }`, `429 { error: 'rate_limited' }` + `Retry-After` (20 запросов/мин на IP, in-memory).
- Env: `XAI_API_KEY`, `XAI_MODEL` (по умолчанию `grok-4-1-fast-non-reasoning`).

## Правила для UI

- Три показателя (recurring / potential / reported) показывать раздельно, не складывать.
- Reported — только «self-reported, not bank-verified».
- Negotiate без `targetPriceCents` → экономия 0, скрипт доступен.
- Тексты на английском (US), USD.
