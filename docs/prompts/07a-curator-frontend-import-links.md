# Gemini — старые ссылки и ручная коррекция импорта

Проект: /Users/nuras/Desktop/businesscup. Прочитай AGENTS.md, исходный аудит и docs/audits/2026-11-14-wave2-review.md. Предыдущая интеграция принята: 184 unit и 17 E2E проходят.

Разрешены src/components/**, src/app/** кроме api, README.md, e2e/curator-frontend.spec.ts. Не меняй src/lib/**, shared types/API/configs/dependencies, чужие тесты и отчёты. Без commit/push/deploy и автоматического запуска других агентов. Сохраняй чужие правки.

1. W2F1. После demo открыть /action?id=exp-00000000000000000000000000000000. Сейчас UI выбирает Streaming A и отправляет POST. Исправь: явно заданный неизвестный/устаревший ID должен давать Expense not found и Back to Review, без ActionDetail/Copy/AI-запроса. Различай пустой /action (первое действие допустимо) и явный неверный ID. Это касается /action/[id] и ID расхода, который теперь Keep/Not recurring/удалён. Изменение URL должно менять выбор: устаревший локальный selectedId не имеет приоритета над новым route id. Новые непрозрачные IDs и миграцию не меняй.

2. F09 частично. Дай Edit и Exclude любым пригодным для редактирования строкам preview, а не только error. Для исключённых строк добавь Restore. Исправление/исключение/восстановление пересчитывает candidates и readiness; Analyze недоступен, когда кандидатов нет. Не теряй исходные индексы и user-facing line numbers. Нужны desktop и mobile. У одновременно смонтированных mobile/desktop editors не должно быть одинаковых input id. Сохрани safe rendering без HTML из CSV.

3. F08 UI. Добавь явный optional Debit column selector к существующему mapping.debitColumn. Объясни, что при отдельном Debit поле amount представляет Credit; знак применяется к обычной общей Amount. Нулевой Debit не должен скрывать ненулевой Credit в preview. При редактировании не превращай credit в debit из-за выбора одной общей колонки: показывай/правь обе стороны отдельно, если используется отдельный формат. Бизнес-логику нулей и конфликтов исправляет Claude в engine. Тип ColumnMapping уже содержит debitColumn, расширять shared types не нужно.

4. Добавь E2E: неверный ID и старый ID после миграции не показывают другой расход/не делают POST; валидная ссылка выбирает нужный расход; /action без id продолжает работать; edit valid row, exclude/restore и пересчёт; ручной mapping нестандартных названий Paid/Received с нулями на неиспользованной стороне. На mobile 360/375 проверить заполненный preview и editor. Миграцию seed-данных готовь через существующий формат localStorage, не меняй store.

Сохрани safe POST, мгновенный персонализированный Template, отсутствие повторов на status/reported и новые непрозрачные URLs. Не добавляй share/PDF/аккаунты и не объявляй весь F09 закрытым: ручная группировка расходов остаётся отдельной задачей.

Запусти typecheck/lint/unit, E2E только последовательно после готовности backend; не конкурируй за .next-e2e. Только synthetic data и mocked AI. Если зависимость от engine ещё не готова, укажи конкретный отложенный сценарий, не скрывай через skip. Верни файлы, результаты, остатки.
