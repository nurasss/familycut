# Gemini — frontend-интеграция ручной группировки F09

Проект: /Users/nuras/Desktop/businesscup. Ты владелец frontend. Прочитай AGENTS.md, docs/design/manual-grouping-contract.md (Accepted; §14 имеет приоритет), docs/audits/2026-11-14-grouping-engine-review.md и текущие grouping.ts/detect.ts. Engine принят куратором: 328 unit и 21 production E2E. Реализуй интеграцию полностью, затем проверь её.

## Разрешённые файлы

- src/components/audit/import-adapter.ts
- src/components/audit/import-tab.tsx
- src/components/audit/preview-rows.tsx
- Новые компоненты только в src/components/audit/ для grouping и диалогов
- src/app/audit/page.tsx
- e2e/manual-grouping.spec.ts (новый)
- README.md: только описание нового пользовательского поведения/ограничений

Не менять src/lib/** (включая engine и типы), store/persist, AI/API, results/action, существующие E2E, конфиги/зависимости, AGENTS.md, ТЗ, docs/CONTRACT.md и принятые контракты/аудиты. Сохрани все чужие изменения. Если интерфейс engine мешает реализации, покажи конкретный воспроизводимый случай куратору; не подменяй расчёт в UI. Без commit/push/deploy, запуска других агентов и реальных LLM-запросов.

Перед кодом прочитай применимые установленные руководства node_modules/next/dist/docs/. Для библиотечных API соблюдай Context7 из AGENTS.md; при недоступности укажи это и проверь установленную версию. Сохрани существующий дизайн и доступность, без общего редизайна.

## 1. Адаптер и источники

Добавь необязательный пятый параметр groups?: readonly GroupAssignment[] в evaluateMappedRows. Сначала сопоставь успешно распарсенные транзакции с исходными rawIndex через activeIndices/errorByEffectiveIdx/txCursor, создай копии с sourceIndex: rawIdx. Затем один раз вызови analyzeTransactions(txs, { groups }). Индексы после фильтрации не выдавай за rawIndex.

В ok:true добавь sources: ExpenseSource[], groupReports: GroupReport[]. В RowPreviewItem — expenseId? и groupId? по фактическим источникам/назначениям; не ищи принадлежность через transactionId. Сохрани номера физических строк, диагностику, refund/credit/exact-dedup, обе колонки Debit/Credit и прежние счётчики. Истинный exact duplicate не выбирается для группы; одинаковые no-ID списания, лишь помеченные duplicate_candidate у расхода, остаются доступными для Split.

Передавай групповые expenses дальше существующим путём. Не создавай собственные Expense, цены, частоты или evidence в UI.

## 2. Выбор строк и операции

Назначения и выбранные rawIndex живут только в памяти ImportTab отдельно для CSV/paste. Используй экспортированные applyGroupOp, GroupAssignment и GroupOpResult. Чекбоксы доступны у активных валидных расходных строк. Refund/credit/exact duplicate/error/skipped не добавляй в выбор; причины доступны пользователю.

Дай понятные действия Split (отдельная услуга), Merge (одна услуга), необязательное имя до 80 символов, Undo назначения и возврат к автоматическому режиму через clear. Split допускает одну строку, Merge требует минимум две. Ошибки applyGroupOp показывай, не скрывай. После операции выбор очищается. Перенос строк между назначениями идёт через applyGroupOp.

Покажи список назначений со статусом текстом, выбранным составом/числом активных строк и ignored/issues. Для applied/no_expense явно сообщи, что выбранные строки не образовали recurring expense. Не обещай, что inactive применён. Результаты и recurring-кандидаты пересчитываются по engine; не фильтруй выбор только по первым нескольким preview-строкам.

## 3. Подтверждение, readiness и жизненный цикл

rejected и needs_confirmation блокируют Analyze; inactive не блокирует, причина видна. Оба уровня readiness (ImportTabState и AuditPage) исключают обход. На pending/rejected можно Undo/clear, после чего автоматический расчёт снова доступен.

Для needs_confirmation покажи доступные факты proposal: последнюю цену, частоту/годовой итог, количество списаний/частей, gapDays и предупреждение о возможной смене услуги. Если прежняя цена не предоставлена в proposal, не выдумывай её: покажи исходные выбранные строки. Подтверждение — applyGroupOp(..., {type:'confirm', groupId, kinds:proposal.requires, proposalKey:proposal.proposalKey}). Сохраняй confirmedFor только этим путём. Cancel не применяет Merge и оставляет Analyze заблокированным до Undo либо подтверждения.

При Edit/Exclude/Restore сбрасывай confirmed и confirmedFor затронутых назначений; новый proposal должен быть подтверждён отдельно. Особенно проверь Exclude → confirm → Restore. Не допускай восстановления старого согласия после возврата прежнего набора строк.

Новая вставка/файл, повторный импорт, reset и Delete my data очищают назначения/выбор/подтверждения. Любое изменение mapping, включая debitColumn/sign convention/transaction ID, очищает назначения/подтверждения с понятным пояснением. Сохрани прежнее поведение overrides/skipped. Не теряй защиту от завершения устаревшего асинхронного импорта после Delete my data.

После Analyze preview между маршрутами не сохраняется: объясни, что для изменения состава нужен повторный импорт. Не добавляй историю транзакций в store/localStorage/sessionStorage/URL/API.

## 4. Replace audit

В src/app/audit/page.tsx перед импортным startSession поверх непустой реальной session покажи управляемое подтверждение Replace audit (§12 Q3/§14). Объясни замену расходов, решений, reported savings и семейной цели. Cancel сохраняет весь прежний store/цель и текущий preview, остаётся на /audit. Replace создаёт новую session обычным startSession и переводит на /results; старые решения/статусы/цель не переносятся.

Ручной переход к результатам и существующий Try demo flow не получают это подтверждение. Не создавай обход для sample CSV/paste при замене реального аудита. При открытом диалоге и изменившемся preview/готовности не анализируй устаревший снимок; закрывай либо повторно валидируй актуальное состояние. Delete my data закрывает диалоги.

## 5. Доступность и приватность

Уникальные label/id для чекбоксов и полей (учти одновременно присутствующие mobile/desktop ветки). Клавиатурное управление, focus при открытии/закрытии диалогов, Escape/Cancel и возврат фокуса, читаемые статусы/ошибки. На 360/375px выбор строк, панель и открытые диалоги не создают горизонтального скролла.

В persisted session остаются только прежние Expense-агрегаты/evidence. Group name может стать отображаемым merchant по контракту; это не разрешение хранить rawRows, sources, assignments или дополнительные банковские колонки. AI request по существующей safe-request политике: неизвестная подпись → Service provider, каноническая → allowlist. groupId/sourceIndex/rawIndices/proposalKey/confirmedFor в POST отсутствуют.

## 6. Обязательные E2E в новом файле

Используй production build, XAI_API_KEY='', мок /api/ai/action. Не ослабляй прежние проверки и не добавляй skip.

1. Split двух одинаковых no-ID аккаунтов Netflix (3 месяца ×2) → 37176 ¢/год, отдельные источники; Undo/clear → 18588 и duplicate hint.
2. Merge Netflix Jan–Mar + Jun–Aug → 18588, одна карточка, Grouped by you / Gap of 92 days. Дополнительно разные названия Netflix/NFLX, включая фрагмент, отсутствующий в автоматических candidates.
3. Параллельные Adobe 999/1999 → rejected overlapping_services, итог 35976 сохранён, Analyze заблокирован, Undo возвращает readiness. mixed_periods также отклоняется.
4. Большой скачок через разрыв → needs_confirmation и блокировка; Cancel не применяет; confirm применяет 23988. Edit суммы/даты при тех же rawIndices и Exclude → confirm → Restore требуют нового подтверждения. Обычные Edit/Exclude/Restore пересчитывают состав/итог.
5. Новый файл/вставка/mapping сбрасывают назначения и показывают нужное пояснение. Delete my data очищает всё; reload не возвращает импорт/группы.
6. Analyze → results → reload сохраняет расходы/evidence без rawRows, sourceIndices, rawIndices, groupReports/assignments, proposalKey и лишних колонок в localStorage. Проверь фактический AI POST для пользовательского имени с синтетической PII: только разрешённые поля, merchant Service provider, opaque action URL.
7. Выбор и диалоги доступны с клавиатуры; 360/375px без overflow и duplicate DOM ids, в том числе открытые редактор строки/диалог.
8. Реальный предыдущий audit с решениями/reported/целью: Cancel Replace сохраняет session без изменений; Replace заменяет её и убирает прежние значения. Старый /action?id после замены — Expense not found без AI POST. Пустая/demo session и ручной переход работают как раньше.

Проверяй пользовательское поведение и суммы, а не только наличие элементов; фикстуры синтетические. При необходимости разбей перечисленное на большее число тестов.

## Проверки и отчёт

Последовательно, без конкурирующих сборок: npm test; npm run typecheck; npm run lint; XAI_API_KEY='' npm run test:e2e; git diff --check. Не повышай пороги производительности/таймауты ради зелёного результата. Не завершай и не убивай чужие процессы. Production build выполняется внутри test:e2e.

В отчёте: точные изменённые файлы; соответствие §1–§6; фактические суммы примеров и payload; команды/exit codes/число тестов; доступность и reset/stale-confirmation; ограничения. Отдельно перечисли, что не проверено. F09/P0 полностью закрытым до кураторской проверки не объявляй.
