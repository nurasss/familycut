# FamilyCut — приёмка интеграции F09, 15 ноября 2026

Ручная группировка до Analyze принята в согласованном объёме Accepted manual-grouping-contract.md (§14 приоритет). Это не заявление о завершении всего P0, P1 или комплекта сдачи.

## Реализация

Gemini 4 Hydrogen подключил адаптер/sourceIndex и UI Split/Merge/Undo/Clear, статусы и подтверждения, блокировку Analyze, reset и Replace audit. Второй Gemini 4 Hydrogen независимо проверил engine, затем готовый frontend; подтверждённых дефектов относительно контракта статическим ревью не найдено. Эти read-only проверки не подменяют запуск тестов.

Куратор сверил изменения с сохранёнными SHA-256 engine-этапа и прочитал конечные пути адаптера, readiness, Edit/Exclude/Restore, подтверждений и replacement. Engine, store, parser, AI/API и зависимости не менялись после принятого engine-этапа.

Существующие изменения ограничены README, audit/page, import-adapter, import-tab, preview-rows, двумя сценариями curator-frontend.spec.ts и документацией CONTRACT. Новые компоненты: grouping-panel, group-confirm-dialog, replace-audit-dialog. Новый E2E: manual-grouping.spec.ts (8 сценариев).

## Проверки куратора

- npm test: 328/328, 10 файлов, 3.39 с; порог performance-теста 500 мс сохранён.
- npm run typecheck: exit 0.
- npm run lint: exit 0. В повторном запуске появились два предупреждения no-unused-vars в стороннем brag-output/work/audio.mjs (lp/i); F09-файлы без предупреждений. Этот артефакт не менялся в рамках F09.
- git diff --check: exit 0.
- XAI_API_KEY='' npm run test:e2e: exit 0, 29/29, 2.8 минуты, production build .next-e2e.
- После уточнения подсказки имени: повторные lint/diff-check и свежая production-сборка с mobile grouping E2E — 1/1 PASS (360/375px, диалог, клавиатура и уникальные id).

Проверены Split двух no-ID Netflix-аккаунтов (37176 ¢/год); Merge разорванных фрагментов (18588 ¢); разные названия с сохранением ранее отбрасываемого NFLX; overlap/mixed_periods и блокировка; актуальное подтверждение скачка; Edit суммы/даты и Exclude → confirm → Restore; mapping/new-file/paste/delete reset; хранение/AI payload; клавиатура, уникальные id и ширины 360/375; Replace audit Cancel/Replace и старые action links без POST.

## Правки при приёмке

Первый агент оставил два падения старых E2E: сценарии повторно импортировали реальные данные и ожидали прямого перехода на results. Куратор обновил только эти два места: теперь они явно проверяют диалог Replace audit и нажимают Replace. Прежние проверки суммы, приватности, статусов и overflow сохранены; skips/обходов/ослабления assertions нет. Все 29 прошли после адаптации.

Куратор исправил одну неточную пользовательскую подсказку в grouping-panel: имя услуги сохраняется локально как merchant расхода после Analyze, хотя сами назначения остаются только в preview. Утверждение «имя только в памяти preview» удалено. CONTRACT дополнен фактическим путём UI, readiness/reset и replacement. Это единственная продуктовая правка куратора в этом этапе, остальные продуктовые изменения выполнил Gemini.

## Ограничения

- Изменение состава после Analyze требует повторного импорта; raw history и назначения не сохраняются.
- Слияние не доказывает активность услуги и не восстанавливает отсутствующую историю. Confidence и evidence остаются эвристическими.
- Try demo всё ещё может заменить реальный audit: защита F09 распространяется на импорт, по принятому контракту не меняет отдельный Try demo flow.
- Полный аудит доступности/реальные Safari iOS и Android не выполнены. Headless Chrome на 360/375 не заменяет их.
- Рекомендации по money input, повреждённому persisted state, P1/PDF и материалам питча остаются отдельными задачами.
- Реальных LLM-запросов, commit/push/deploy не было. Изменения пока локальные; эта проверка не подтверждает текущий публичный deployment.

SHA-256 и точные результаты: 2026-11-15-grouping-integration-evidence.json.
