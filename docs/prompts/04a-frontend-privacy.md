ЭТАП 4A — точные формулировки приватности и подсказки в действиях (по ТЗ на исправления: FC-PRIV-03, FC-UX-07). Прод живой: https://familycut.vercel.app. Параллельно бэкенд делает 4B в src/lib/**, src/app/api/**, e2e/security.spec.ts. Туда не заходи.

Как на самом деле устроен поток данных: CSV, вставка и ручной ввод разбираются, анализируются и считаются в браузере. Сырые строки, CSV и ID транзакций никуда не уходят. Когда пользователь просит AI-письмо или скрипт, на сервер (POST /api/ai/action) уходят только: название мерчанта, тип действия, частота списания, текущая цена, целевая цена (если есть), тон. Сохранённый аудит лежит в localStorage этого устройства до Delete my data.

1. FC-PRIV-03. Убери абсолютные утверждения вида «ничего не отправляется».
   - src/app/audit/page.tsx ~стр. 149, сейчас "Nothing is uploaded — it's processed in your browser." Замени на:
     "Your CSV and transaction rows stay in your browser. If you request an AI-generated message, only the merchant name, action type, billing frequency, and price information are sent to our server."
   - src/components/audit/import-tab.tsx ~стр. 225, сейчас "Nothing is uploaded to any server." Замени на короткий вариант: "Your file is read in your browser and never uploaded."
   - src/components/audit/manual-tab.tsx ~стр. 277 "Everything stays in your browser." → "Your entries are saved only in this browser."
   - src/app/page.tsx: стр. ~75 ("Your CSV stays in your browser.") можно оставить. Блок Local-Only Data Processing (~стр. 296–299) дополни одной фразой: "Only when you ask for an AI-written email or script do we send that one bill's name, action, frequency and price."
   - grep по src/ на "nothing", "never leaves", "uploaded", "100% private" и поправь остальные абсолютные формулировки в том же духе.
2. Экран действия (src/components/action/action-workspace.tsx):
   - Рядом с текстом письма/скрипта должна быть короткая строка: "Review and send it yourself. FamilyCut doesn't cancel or contact anyone for you." Если похожая уже есть, не дублируй.
   - FC-UX-07: должны быть видны текущая цена, целевая цена (для Negotiate) и статус not started / attempted / completed. Для расходов с frequency yearly покажи подсказку: "Billed yearly: savings may start at your next renewal."
3. README.md, раздел Privacy: приведи в соответствие с п.1 (то же самое по смыслу, без «ничего не отправляется»). Добавь строку, что ID транзакций не сохраняются в localStorage (это делает бэкенд в 4B).
4. Если какой-то тест (src/**/*.test.ts, e2e/smoke.spec.ts) проверяет старые строки, обнови его. e2e/security.spec.ts не трогай.
5. Проверь в браузере на 375 px: новые тексты переносятся, горизонтального скролла нет; на desktop тексты не ломают сетку.

Ограничения: только src/app/** (кроме api), src/components/**, README.md и тесты на копирайт. Не убивай процессы. Не выводи .env.local. Не пушь.

ГОТОВНОСТЬ: typecheck, lint, test, build зелёные. Коммит: "fix(ui): exact privacy copy, action hints (FC-PRIV-03, FC-UX-07)".
В ОТВЕТЕ: каждая строка «было → стало» с файлом, скриншот или описание проверки на 375 px, отступления.
