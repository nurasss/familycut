<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Порядок работы с пользователем

По договорённости от 14 ноября 2026 года основной ассистент работает куратором проекта.

- Gemini отвечает за frontend, интерфейс и landing.
- GPT или Claude отвечает за backend, бизнес-логику, расчёты и обработку данных.
- Куратор готовит готовый к копированию промпт для нужного агента. Пользователь сам передаёт промпт агенту и возвращает куратору его вывод.
- В промпте указывать задачу, разрешённые файлы, границы ответственности, критерии приёмки, необходимые проверки и формат отчёта. При параллельной работе разделять владение файлами и заранее согласовывать общие контракты.
- После получения результата куратор проверяет фактический diff и реализацию относительно ТЗ, запускает подходящие проверки, сообщает замечания и при необходимости готовит следующий промпт на исправления. Одного заявления агента об успехе недостаточно.
- Цикл работы: промпт → пользователь передаёт агенту → агент выполняет → пользователь возвращает результат → куратор проверяет → следующий промпт или приёмка.
- По умолчанию куратор сам не реализует продуктовые изменения и не запускает агентов автоматически. Прямое поручение пользователя выполнить работу самостоятельно или запустить агента меняет этот порядок для соответствующей задачи.
