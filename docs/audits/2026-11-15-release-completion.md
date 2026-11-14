# FamilyCut — финальная локальная приёмка, 15 ноября 2026

Локальная реализация P0 + F09 и комплект материалов приняты. Полная сдача проекта ещё не завершена: финальные изменения не опубликованы; проверка человека без подсказки, реальных мобильных браузеров и организационные шаги остаются внешними условиями. Этот статус не подменяет Definition of Done из docs/TZ.md.

## Что завершено

Три Gemini 4 Hydrogen подготовили release-изменения и материалы. Куратор прочитал фактический код и проверил объединённое состояние.

- Все UI-входы Try demo запрашивают подтверждение перед заменой реальных расходов или цели. Cancel/Escape сохраняют данные и несохранённый preview/ввод; пустой/demo аудит открывает пример сразу.
- Денежный ввод разбирается и форматируется через целые центы, с сохранением прежних форматов и лимита $1M.
- Runtime-валидация localStorage сохраняет валидные записи при частичном повреждении, отбрасывает некорректные обязательные поля, нормализует enum/optional поля и не допускает подмену store actions. Миграция opaque ID и версии сохранены.
- Ручная группировка F09 и предыдущие privacy/parser/lifecycle/AI исправления сохраняют принятые контракты.
- Подготовлены 10-страничный PDF-питч, исходник, сценарии выступления и demo, checklist и пять резервных PNG реального интерфейса на синтетике.
- README и CONTRACT обновлены. В PDF убраны неподтверждённые обобщения о конкурентах и обещание полностью офлайн-сайта; гипотезы обозначены явно.

## Итоговые проверки

| Проверка | Результат |
|---|---|
| npm test | 12 файлов, 350/350 PASS; performance-порог 500 мс сохранён |
| npm run typecheck | exit 0, повтор после всех тестовых правок |
| npm run lint | exit 0, 0 ошибок; 2 прежних предупреждения в стороннем brag-output/work/audio.mjs |
| git diff --check | exit 0 |
| XAI_API_KEY='' npm run test:e2e | production build .next-e2e, 37/37 PASS, 2.5 минуты |
| PDF | 10 страниц 960×540 pt, все отрендерены и визуально просмотрены; изменённые страницы проверены повторно |
| Backup screenshots | 5 PNG, изолированный локальный demo; AI-запрос перехвачен локально, реального LLM нет |
| Узкий поиск credential literals | В tracked-файлах совпадений не найдено; .env.local не читался, это не полный аудит истории |

Первые E2E-прогоны выявили три ошибки локаторов новых тестов: имя вкладки Add manually, неоднозначные textbox/Family trip. После уточнения локаторов ещё исправлено имя кнопки Analyze expenses (9) в новом ручном сценарии. Продуктовые проверки не удалялись, skips/retries/ослабления assertions не добавлялись. Финальный полный прогон прошёл все 37.

Логи, SHA-256 исходников/тестов/материалов и результаты: [release-evidence.json](./2026-11-15-release-evidence.json), [логи](./2026-11-15-release-evidence/).

## Соответствие FR-01…FR-15

| Требование | Фактическое доказательство | Статус |
|---|---|---|
| FR-01: без signup, два CTA, HTTPS | landing source; T-14; public-availability.json | Локальный поток принят; публичный HTTPS доступен, версия не синхронизирована |
| FR-02: ≥10 ручных записей/правка/удаление | manual-entry.spec.ts: 10 записей, правка имени/цены/категории, удаление, reload, $677.04/year | PASS |
| FR-03: paste | engine.test.ts, csv-errors.test.ts, smoke T-01 | PASS |
| FR-04: CSV/mapping/sign/debit-credit | engine/csv-errors units; curator-frontend F08 | PASS |
| FR-05: preview/ошибки | csv-errors units, curator Edit/Exclude/Restore и import readiness | PASS; повреждённые кавычки отклоняют импорт целиком с объяснением |
| FR-06: нормализация/частота/evidence/confidence | engine/series/grouping units, карточки результатов | PASS на синтетическом наборе; эвристика |
| FR-07: refund/duplicate | engine/series units, manual-grouping E2E | PASS |
| FR-08: ручная коррекция/решения | lifecycle units, curator frontend и grouping E2E | PASS |
| FR-09: целые центы | money/input units, manual input E2E, ручная итоговая сумма | PASS |
| FR-10: три метрики | money/lifecycle units, smoke T-14, статус/reported E2E | PASS |
| FR-11: Review candidates без авто-Cut | pickReviewCandidates unit-тест, results rendering | PASS на синтетике; максимум 5, причины показаны |
| FR-12: email/script/Copy/fallback | ai/response-check/safe-request units, smoke T-10/T-14 | PASS без live LLM |
| FR-13: goal/progress | money units, demo $1500/48%, goal E2E | PASS |
| FR-14: persist/delete | ids/lifecycle/persisted-state units, smoke T-11, manual reload | PASS |
| FR-15: synthetic demo без ключа | smoke T-14; release readiness entry points | PASS |

T-01…T-16 покрыты совокупностью engine/money/AI units и smoke/curator/manual-entry/manual-grouping/release-readiness E2E. Новые release-условия также покрыты. P1 T-17…T-19 не заявляются выполненными.

## Лендинг и публикация

Лендинг реализован: hero, Start free audit/Try demo, вычисляемый пример трёх метрик и цели, три шага, privacy-блок. Сайт и GitHub отвечают HTTP 200: [read-only evidence](./2026-11-15-public-availability.json). Публичная главная не содержит актуальную локальную формулировку summary fields; HTTP 200 не доказывает соответствие deployment рабочему дереву.

Commit/push/deploy не выполнялись. Ранее установленная граница публикации сохранена. Перед внешней сдачей требуется разрешённая публикация финального кода и функциональная проверка опубликованного URL.

## Что ещё требуется для полной сдачи

1. Согласовать публикацию, просмотреть включаемые файлы (не захватывая сторонний brag-output), commit/push/deploy и проверить финальный HTTPS deployment.
2. Проверить реальный телефон iOS Safari/Android Chrome и пройти сценарий без подсказок с замером <5 минут. Автоматический Chromium-тест и scripted demo не доказывают результат независимого человека.
3. Подтвердить состав команды/спикера, регламент и форму сдачи организатора, выполнить выступление с таймером. Данные не выдумывались; чек-лист содержит эти внешние шаги.

P1 (sharing, accounts, два CSV, reminders, dedicated full-audit PDF) остаётся за пределами согласованного P0. PDF-питч — отдельный готовый материал сдачи. Реальные LLM-вызовы, оплата и маркетинговые показатели не заявляются проверенными.
