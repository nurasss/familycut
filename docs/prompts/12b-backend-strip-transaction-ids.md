ЭТАП 12B — FC-SEC-02: банковские ID транзакций всё ещё сохраняются в localStorage. Это последний P0 BLOCKER перед публикацией.

Проверено куратором на production-сборке: /audit → Upload CSV с колонкой "Transaction ID" (TXN-SECRET-111/222/333, три списания NETFLIX.COM) → Analyze → в `localStorage['familycut:audit:v1']` лежит `"transactionIds":["TXN-SECRET-111","TXN-SECRET-222","TXN-SECRET-333"]`.

Путь утечки: detect.ts (~446, ~473, ~718) кладёт `txs.map(t => t.id)` в Expense.transactionIds → src/app/audit/page.tsx:224/251 вызывает startSession(current.expenses) как есть → store.ts partialize сохраняет session целиком → persisted-state.ts:177 при rehydrate тоже оставляет transactionIds. Перешифровка expense id (ids.ts) эту проблему не решает: это другое поле.

Что сделать (только src/lib/**, тесты, e2e/security.spec.ts):
1. Результат analyzeTransactions НЕ меняй. На transactionIds опираются дедупликация, сортировка (detect.ts ~1390) и тесты engine/series/grouping. Если ID нужны группировке F09 до Analyze, это нормально: они живут в памяти до startSession.
2. Отрезай ID на границе store: startSession и addExpense кладут расходы с `transactionIds: []`. Используй одну экспортируемую функцию (например `stripTransactionIds(expenses)`), а не копию логики в разных местах.
3. persisted-state.ts: sanitize при чтении всегда возвращает `transactionIds: []`, что бы ни лежало в хранилище. Подними STORAGE_VERSION на 1 и добавь шаг migrate, который убирает ID у старых сессий и сохраняет решения, цены, target, статусы, reported, notes, goal, isDemo. Ключ `familycut:audit:v1` не меняй. Существующие миграции (opaque expense id) должны продолжать работать по цепочке.
4. Проверь, что после Analyze в UI ничего не использует transactionIds (results, action, grouping-panel, print). Если что-то использует, опиши в отчёте и не ломай.
5. Тесты:
   - unit: startSession с расходами, у которых есть ID → `JSON.stringify(persisted)` не содержит ни одного ID; migrate/sanitize старого blob с ID → ID нет, decision/targetPriceCents/actionStatus/goal на месте; повторная sanitize идемпотентна.
   - e2e/security.spec.ts: Upload CSV (через setInputFiles) с колонкой Transaction ID `TXN-SECRET-…` → Analyze → /results → localStorage не содержит `TXN-SECRET`; reload → Netflix $185.88/yr на месте; Delete my data → ключа нет. Плюс: тело POST /api/ai/action на /action для этого расхода не содержит `TXN-SECRET`.
   - Существующий фикстурный тест release-readiness.spec.ts (transactionIds: []) не ломай.

Ограничения: не трогай src/app/** (кроме чтения), src/components/**, README.md, docs/submission/**. Не убивай процессы (никаких pkill). Не читай и не выводи .env.local. Не коммить и не пушь: коммит делает куратор после проверки.

ГОТОВНОСТЬ: npm run typecheck, npm run lint, npm test, `XAI_API_KEY='' npm run test:e2e` зелёные. Пиши только реальные результаты с кодами выхода.
В ОТВЕТЕ: краткий диф (файлы и функции), числа тестов unit/e2e, новый STORAGE_VERSION, отступления.
