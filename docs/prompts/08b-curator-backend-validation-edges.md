# Claude — точечная доработка валидатора и диагностики CSV

Проект: /Users/nuras/Desktop/businesscup. Прочитай AGENTS.md и docs/audits/2026-11-14-wave3-review.md. Независимо подтверждены 257 unit и 21 production E2E. F08, структура AI-ответа и F12 приняты; F07/F11 имеют воспроизводимые края ниже.

Разрешены src/lib/ai/response-check.ts, его тесты, src/lib/engine/parse.ts, его тесты, затронутые разделы docs/CONTRACT.md. Если для проверки retry нужен src/lib/ai/ai.test.ts/safe-request.test.ts, дополняй проверки без ослабления существующих. Frontend, E2E, configs/dependencies, ТЗ, чужие отчёты, detector/store/IDs не менять. Без commit/push/deploy, реальных LLM-запросов и запуска агентов.

1. W3B1 / F11. Сейчас containsUnverifiedContact удаляет ВСЁ внутри коротких квадратных скобок. Поэтому validateModelAnswer принимает контакты в body/steps/limitations/callScript: Visit [https://evil.com], Email [support@evil.com], Call [1-800-555-0100]. Разрешай исключение только для согласованных текстовых заполнителей [Account email], [Billing date], [Customer service channel], [Your name]; произвольные скобки не должны скрывать контакты. Конечный список TLD также пропускает support.example.co.uk, cancel.example.xyz, example.ru/help — исправь распознавание обычных доменов. Не путай допустимые суммы, даты, e.g./i.e. и заполнители с контактами. Не заявляй гарантии распознавания всех обфускаций. Покрой предикат, validateModelAnswer и mocked retry/fallback; проверь разные поля ответа и оба действия.

2. W3B2 / F07. Сохрани сигнатуры parseCsv/parsePaste/applyMapping/ParseResult и исправь три случая:
   - `Date,"Description,Amount\n2026-01-01,A,-15` сейчас даёт [] вместо структурной ошибки кавычки в заголовке. Проверяй диагностику, даже когда step не вызван. Валидный header-only CSV остаётся пустым импортом.
   - `Date,Description,Amount\r2026-01-01,A,-15\r2026-02-01,A,-15,EXTRA` сейчас имеет rowLine=[1,1] и errors[0].line=1. Нужны [2,3] и line=3. LF/CRLF/CR учитываются как физические переводы строк без двойного счёта CRLF, включая quoted multiline cells, пустые строки и сообщения об ошибках кавычек.
   - Paste CSV `Date,Description,Amount\n2026-01-01,"hello\n\nworld",-15` сейчас теряет пустую строку внутри Description. Для CSV-пути parsePaste сохраняй содержимое quoted cells так же, как parseCsv, и реальные lineNumber; не фильтруй/не trim каждую физическую строку до CSV-парсинга. Для free-form строк сохрани прежний формат и нумерацию.

Используй Context7 при работе с API Papa Parse согласно AGENTS.md. Сохрани линейный подсчёт строк, cap 5 MB/10,000 записей, диагностику повреждённых соседних строк, Debit/Credit и лимит суммы. Не повышай порог performance-теста 500 мс.

3. W3B3. Исправь CONTRACT: без target fallback всё равно повторяет текущую цену; он не придумывает новую цену/экономию. Не обещай абсолютной фильтрации контактов. Различай нормализованный ActionResponse fallback (nullable поля) и исходный model JSON (строковые поля), если описываешь проверку шаблона.

Добавь регрессии, покажи, что они ловят текущие ошибки; затем npm test, npm run typecheck, npm run lint и git diff --check. Build/E2E в общей директории пока не запускай — куратор выполнит интеграционный прогон. Только синтетические данные/mocked fetch. Сохраняй чужие правки. Верни изменённые файлы, фактические результаты и оставшиеся ограничения; P0/P1 целиком не объявляй закрытыми.
