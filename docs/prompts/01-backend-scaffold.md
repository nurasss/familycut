Ты — backend/logic-разработчик проекта FamilyCut (хакатон Business Cup 2.0, срок сдачи 15 ноября 2026, 12:00). Работаешь в папке /Users/nuras/Desktop/businesscup. Полное ТЗ: docs/TZ.md — прочитай разделы 02, 04, 07, 08, 10, 11, 12 целиком перед началом.

ЗАДАЧА ЭТАПА 1: каркас проекта и общий контракт. После тебя параллельно стартуют фронтенд-агент (UI) и ты же (движок). Поэтому сейчас важны точные типы и сигнатуры, а не полная логика. Не делай UI-страниц сверх заглушек.

1. Каркас
- Next.js (актуальная стабильная, App Router) + TypeScript strict + Tailwind CSS, директория src/, alias @/*. Пакетный менеджер npm.
- shadcn/ui инициализировать (без добавления компонентов — их добавит фронтенд).
- Зависимости: zod, zustand, papaparse (+@types/papaparse). Dev: vitest.
- Скрипты package.json: dev, build, start, lint, test (vitest run), typecheck (tsc --noEmit).
- git init, .gitignore (включая .env*, кроме .env.example), .env.example с XAI_API_KEY= и XAI_MODEL= (без значений).

2. Типы — src/lib/types.ts, строго по ТЗ §12.1:
Frequency, Decision, ActionStatus, Transaction, Expense, FamilyGoal, AuditSession (version: 1).
Добавь:
- type Confidence = 'high' | 'medium' | 'low' | 'manual'
- type SystemFlag = 'duplicate_candidate' | 'price_increase' | 'trial_ending_unknown' | 'review_price' | 'unclear_merchant'; поле flags: SystemFlag[] в Expense.
- type ActionRequest / ActionResponse — точно по JSON из §10.2 (+ Zod-схемы в src/lib/schemas.ts; enum-check, лимиты длины строк: merchant ≤ 80, tone ∈ 'polite' | 'firm').
- type Totals = { recurringAnnualCents; potentialAnnualCents; reportedAnnualCents; plannedGoalPct; reportedGoalPct }.
- Типы импорта: RawRow, ColumnMapping { date; description; amount; debitColumn?; signConvention: 'negative_is_debit' | 'positive_is_debit' }, ParseResult { rows; errors: { line; reason }[] }.

3. Сигнатуры движка (src/lib/engine/*) — пока заглушки, которые бросают Error('not implemented'), КРОМЕ money.ts (его реализуй полностью сейчас, это мало кода):
- parse.ts: parseCsv(text): RawRow[]; parsePaste(text): RawRow[]; applyMapping(rows, mapping): ParseResult
- normalize.ts: normalizeMerchant(raw: string): string
- detect.ts: detectRecurring(txs: Transaction[]): Expense[]
- money.ts: MULTIPLIER, annualCents(priceCents, freq), computeTotals(expenses, goal?): Totals — формулы строго §8.1, §8.4. Только целые центы, никакого float в арифметике денег (проценты — можно, это не деньги). Negotiate без targetPriceCents даёт 0 в potential. reported считается только при actionStatus === 'completed' и наличии reportedNewPriceCents (для Cut — 0). Frequency 'unknown' → в recurring не входит.
- format.ts: formatUsd(cents): string ("$1,234.56").

4. Демо-фикстура — src/lib/fixtures/miller.ts (метка Sample data, вымышленные данные):
- DEMO_EXPENSES — 5 позиций строго по таблице §15.1 (Streaming A $15.49 Cut, Fitness $29.99 Cut, Internet $75 → target $60 Negotiate, Music family plan $16.99 Keep, Cloud storage $9.99 Keep), decision уже проставлены, confidence/reasons правдоподобные.
- DEMO_GOAL = { name: 'Family trip', targetCents: 150000 } (→ ~48% как в §8.4).
- DEMO_TRANSACTIONS_CSV — строка CSV ~25–30 операций за 3 месяца (Date,Description,Amount, отрицательные = списания), включая: эти 5 сервисов с «шумными» названиями (напр. NETFLIX.COM 8844), 1 refund, 1 дубль с одинаковым ID (добавь колонку Transaction ID), продуктовые покупки (grocery) в похожие даты, 1 годовой платёж $120. Нужно для тестов T-04…T-07 и для демо через CSV.

5. Состояние — src/lib/store.ts (zustand + persist в localStorage, ключ 'familycut:audit:v1'), полностью рабочий:
state: session: AuditSession | null; isDemo: boolean
actions: startSession(expenses, {isDemo}), loadDemo(), addExpense, updateExpense(id, patch), removeExpense(id), setDecision(id, decision), setTargetPrice(id, cents|undefined), setActionStatus(id, status, reportedNewPriceCents?), setGoal(goal), deleteAllData() (чистит store и localStorage полностью).
Селектор useTotals() → computeTotals. Не сохранять сырые транзакции в store.

6. API — src/app/api/ai/action/route.ts: пока валидирует вход Zod-схемой и возвращает fallback-шаблон из §10.4 с source: 'fallback' (подключение Grok будет на следующем этапе). Шаблоны — в src/lib/ai/fallback.ts.

7. Тесты: src/lib/engine/money.test.ts — T-01, T-02, T-03, T-08, T-09, T-16 из §14 + итог демосемьи = 72576 центов и planned goal ≈ 48%.

8. docs/CONTRACT.md — коротко: структура папок, владение файлами (ниже), все экспортируемые типы/функции/actions store с одной строкой описания. Это главный документ для фронтенд-агента.

ВЛАДЕНИЕ ФАЙЛАМИ (важно, второй агент работает в той же папке):
- Backend (ты): src/lib/**, src/app/api/**, тесты, конфиги (package.json, tsconfig, vitest, next.config), docs/CONTRACT.md.
- Frontend (Gemini): src/app/** кроме api, src/components/**, src/app/globals.css.
Страницы / , /audit, /results сейчас сделай минимальными заглушками (заголовок + текст "TODO frontend"), чтобы маршруты существовали.

КРИТЕРИИ ГОТОВНОСТИ: npm run build, npm run test, npm run typecheck и npm run lint проходят без ошибок. Сделай git-коммит "chore: scaffold + contract".

В ОТВЕТЕ ПРИШЛИ: дерево созданных файлов, вывод test/build/typecheck (последние строки), содержимое docs/CONTRACT.md, и список любых отступлений от этого промпта с причиной. Ничего не придумывай сверх ТЗ.
