Ты — frontend-разработчик проекта FamilyCut (хакатон, сдача 15 ноября 2026, 12:00). Работаешь в папке /Users/nuras/Desktop/businesscup — Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4, shadcn/ui уже инициализированы.

ПРОЧИТАЙ ПЕРЕД НАЧАЛОМ:
1. docs/CONTRACT.md — типы, функции, store. Это единственный источник правды по данным.
2. docs/design/DESIGN.md + docs/design/landing.png — дизайн-система, эталон стиля и описание всех экранов.
3. docs/TZ.md — разделы 05, 08.2, 08.4, 09, 10.4, 13 (NFR-02).

ВЛАДЕНИЕ ФАЙЛАМИ. Параллельно в той же папке работает backend-агент.
- Ты пишешь ТОЛЬКО в: src/app/** (кроме src/app/api/**), src/components/**, src/app/globals.css, src/app/layout.tsx.
- НЕ трогай src/lib/**, src/app/api/**, package.json, конфиги. Нужен новый shadcn-компонент — добавь его через `npx shadcn@latest add <name>` (он кладёт файлы в src/components/ui — это нормально); других npm-пакетов не ставь без крайней нужды, а если ставишь, укажи это в отчёте.
- Если в контракте чего-то не хватает — НЕ дописывай src/lib, а напиши в отчёте, что нужно от backend.

ЗАДАЧА ЭТАПА 2A — все экраны P0:
1. Тема: токены из DESIGN.md в globals.css (CSS-переменные shadcn: background, primary и т.д. + свои --savings, --chip-cut, --chip-negotiate). Шрифты через next/font: Bricolage Grotesque (заголовки) и Inter (текст), убрать Geist. metadata: title "FamilyCut — find the bills you can cut", description из subheadline. Только светлая тема.
2. / — лендинг как на landing.png с правками из DESIGN.md. "Start free audit" → /audit. "Try demo" → loadDemo() из store, затем переход на /results. Тексты §9.1 — дословно.
3. /audit — три способа ввода (manual / paste / CSV) по DESIGN.md.
   - Manual: работает полностью через store (addExpense / updateExpense / removeExpense).
   - Paste и CSV: вызывай функции движка из @/lib/engine/* по CONTRACT.md (parseCsv/parsePaste → applyMapping → detectRecurring). Backend прямо сейчас реализует их и добавляет analyzeTransactions, suggestMapping и pickReviewCandidates. Пока функция бросает 'not implemented', ловишь ошибку и показываешь Error-состояние с Retry. Все вызовы движка держи в одном адаптере src/components/audit/import-adapter.ts, чтобы при интеграции правка была в одном месте.
   - Файл читай FileReader/File.text() в браузере. На сервер ничего не отправлять.
   - Счётчик строк, Fix/Skip для ошибочных строк, ссылка "Try demo data", "Analyze expenses" → startSession(expenses, {isDemo:false}) → /results.
4. /results — три метрики из useTotals() (разные карточки, разные подписи — §8.2), Review first, список расходов с Keep/Cut/Negotiate/Not recurring (setDecision), target price для Negotiate (setTargetPrice; без target — без суммы экономии), inline-редактирование цены/названия/частоты, фильтры, Family goal (setGoal; имя + сумма; два прогресса: planned и self-reported), тег "Sample data" при isDemo, "Open action plan (N)". Пустая сессия → Empty state со ссылкой на /audit и Try demo. Пока pickReviewCandidates нет — локально в компоненте возьми топ-3 по годовой стоимости среди undecided (вынеси в одну функцию, чтобы потом заменить).
5. /action — по DESIGN.md. Текст: POST /api/ai/action с телом строго ActionRequest (merchant, action, frequency, currentPriceCents, targetPriceCents?, tone) — БОЛЬШЕ НИЧЕГО не отправлять. Показывать source ('ai' → "Written by AI · review before sending", 'fallback' → "Template"). Сеть упала / не 200 → показать локальный шаблон (тот же текст, что в §10.4; если есть экспорт fallback в @/lib/ai — используй его). Copy через navigator.clipboard + состояние "Copied ✓". Статусы через setActionStatus; при Completed — ввод новой цены (Cut = 0) и подпись "Counts as self-reported savings (not bank-verified)".
6. Общий footer с "Not financial or legal advice. Review details before acting." и "Delete my data" → confirm-диалог → deleteAllData() → на /. Степпер 1-2-3 в header на /audit, /results, /action.
7. Гидрация: store читает localStorage на клиенте — зависящий от сессии контент рендерить после mount (useHasHydrated / useEffect), без hydration mismatch.
8. Адаптив и доступность (NFR-02): 360–430px без горизонтального скролла, на мобиле карточки вместо таблиц, тап-зоны ≥44px, label у каждого инпута, видимый focus, клавиатурная навигация по сегмент-контролу.
9. Деньги: показывать только через formatUsd из @/lib/format. Ввод цены пользователем: "$15.49" → 1549 центов через целочисленный парсинг строки (Math.round(parseFloat(x)*100) допустим только во вводе).

ЗАПРЕЩЕНО: фразы "you saved", "we cancelled", "you don't need this"; фейковые отзывы и счётчики пользователей; автоматический Cut; называть recurring spend «потерей».

ГОТОВНОСТЬ: npm run build, npm run typecheck, npm run lint зелёные; demo-путь / → Try demo → /results → Open action plan → Copy проходит в браузере на ширине 375px и 1280px. Коммит "feat(ui): P0 screens" — добавляй только свои файлы (git add src/app src/components; без src/app/api), чужие изменения не коммить.

В ОТВЕТЕ: список файлов, скриншоты или описание каждого экрана (375 и 1280), что не успел, и список того, что нужно от backend.
