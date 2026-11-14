# Gemini — подключить безопасный клиентский AI-запрос

Проект: /Users/nuras/Desktop/businesscup. Продолжаем после первой волны. Прочитай AGENTS.md и docs/audits/2026-11-14-wave1-review.md. Твои предыдущие frontend-исправления проходят 15 E2E; сохраняй их.

Разрешены src/components/**, src/app/** кроме api, README.md, e2e/curator-frontend.spec.ts. Не меняй src/lib/**, API, shared types/configs/dependencies, чужие тесты, ТЗ и аудит. Не делай commit/push/deploy, не запускай других агентов, не откатывай чужие изменения и не показывай env-секреты.

1. В action-workspace.tsx используй существующий buildSafeActionRequest из @/lib/ai/safe-request для каждого POST /api/ai/action. Ручная сборка merchant через slice(0,80) должна исчезнуть. Для неизвестного имени сеть получает Service provider; известное имя канонизируется. Для Cut targetPriceCents отсутствует.
2. Сохрани стабильность effect: изменение actionStatus/reported price не запускает POST. Ключ запроса строится по безопасным полям payload, expense id и явной Regenerate; не по всему объекту Expense. Не обходи exhaustive-deps отключением ESLint.
3. Исходное имя можно сохранить в локальном fallback и локальных заголовках. Не помещай его в другие поля запроса, URL, headers или telemetry. Если сервер вернул source=fallback с generic именем, сохрани персонализированный локальный Template. Ответ AI для неизвестной услуги может оставаться generic; не добавляй исходные данные в повторный запрос.
4. Добавь сетевые E2E на реальные UI-сценарии с синтетическими именем/email/account number: manual и paste/CSV → решение → action. Проверяй значения POST, а не только ключи. Для обычного Netflix ожидается Netflix; для неизвестной услуги — Service provider. Copy доступен сразу, в локальном Template остаётся исходное имя. Проверяй после ответа source=fallback и reload. Остальные поля notes/reasons/IDs в сети не появляются.
5. Добавь проверку URL при переходе и reload импортированного действия. Сейчас старый Expense.id содержит merchant slug и передаёт имя в GET. Это исправляет Claude в src/lib/**: не делай frontend-обход. До готовности backend такой тест может падать; укажи зависимость и не называй его PASS/не скрывай через skip. Учитывай все запросы, а не только POST.
6. Обнови README по фактическому потоку данных. Не обещай полное отсутствие PII до исправления backend IDs. Не объявляй P1 или полный аудит закрытыми.

Запусти typecheck, lint, unit tests. Build/E2E — последовательно, без конкуренции с чужими сборками; если backend ещё меняется, сообщи об отложенной интеграционной проверке. Только mocked AI/пустой ключ.

Верни файлы, пример фактического safe payload, результаты проверок и остаток зависимости от backend. Не меняй поведение уже принятого импорта и accessibility.
