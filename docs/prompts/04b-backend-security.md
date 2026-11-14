ЭТАП 4B — безопасность хранения и QA-отчёт (по ТЗ на исправления: FC-SEC-02, FC-QA-04). Прод живой: https://familycut.vercel.app, push в main деплоит автоматически. Параллельно фронтенд делает 4A в src/app/** (кроме api), src/components/** и README.md. Туда не заходи.

1. FC-SEC-02. В localStorage не должно быть банковских ID транзакций.
   Сейчас detect.ts (~стр. 188 и 211) пишет `transactionIds: txs.map(t => t.id)`, а store.ts через zustand persist сохраняет всю session. После анализа UI эти ID не использует (проверь grep).
   a. Результат analyzeTransactions НЕ меняй: на transactionIds опираются тесты дедупликации в engine.test.ts (стр. ~269, ~368). Дедупликация и счётчик дублей должны работать как раньше.
   b. Отрезай ID на границе store: startSession и addExpense кладут в session расходы с `transactionIds: []`. Дополнительно partialize при записи тоже отдаёт расходы без ID. Так ID не попадут на диск, даже если кто-то потом обойдёт startSession.
   c. Persist: version 1 → 2 и `migrate`, который у старой сессии обнуляет transactionIds и сохраняет решения, цены, target, статусы, reported, goal, isDemo. Ключ `familycut:audit:v1` оставь прежним, тогда Delete my data продолжит его чистить.
   d. Демо-фикстуры (TX-1001…) синтетические, но через startSession они тоже пройдут очистку. Так и должно быть.
   e. Тесты:
      - Vitest: после startSession с расходами, у которых есть ID, JSON в localStorage не содержит ни одного ID. Если в vitest нет localStorage, вынеси partialize и migrate в экспортируемые чистые функции и тестируй их.
      - Vitest: migrate(v1 с ID) → ID нет, decision/targetPriceCents/actionStatus/goal на месте.
      - e2e/security.spec.ts: Paste с колонкой id (например `TXN-SECRET-123`) → Analyze → /results → `localStorage.getItem('familycut:audit:v1')` не содержит `TXN-SECRET-123`; после reload расходы и решения на месте.
      - e2e: при генерации письма тело POST /api/ai/action не содержит ID и сырых строк (проверка уже есть, убедись, что она покрывает импорт, а не только демо).
2. FC-QA-04. Создай docs/QA_REPORT.md (English): дата, ОС, Node и npm (`node -v`, `npm -v`), результаты `npm run typecheck`, `npm run lint`, `npm test` (число тестов), `npm run build`, `npm run test:e2e` (список кейсов PASS/FAIL), таблица T-01…T-16 с указанием, каким тестом покрыт каждый, отдельная строка про production smoke (заполни как "manual, see below" и оставь пустой чек-лист: устройства iOS Safari / Android Chrome, 360/375/390/430/1280). Пиши только реальные результаты прогонов, ничего не отмечай PASS без нулевого кода выхода.
3. Проверь .env.example: только пустые значения и комментарий. В README не лезь, его правит фронтенд.

Ограничения: не трогай src/app/** (кроме api), src/components/**, README.md. Не убивай процессы (никаких pkill). Не выводи содержимое .env.local. Не пушь.

ГОТОВНОСТЬ: typecheck, lint, test, build, test:e2e зелёные. Коммиты: "fix(store): never persist bank transaction IDs (FC-SEC-02)", "docs: QA report (FC-QA-04)".
В ОТВЕТЕ: диф store.ts кратко, вывод тестов (unit + e2e), что в QA_REPORT, отступления.
