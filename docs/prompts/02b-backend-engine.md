Этап 1 принят. ЭТАП 2B (backend): движок импорта/детекции и Grok. Параллельно фронтенд-агент делает UI в src/app/** и src/components/** — эти папки НЕ трогай. Не меняй уже опубликованные в docs/CONTRACT.md сигнатуры без крайней необходимости; если меняешь — обнови CONTRACT.md и явно перечисли изменения в ответе.

Сверяйся с docs/TZ.md §7, §8, §10, §11, §14.

1. Правки по ревью этапа 1 (money.ts):
- recurring: включать только позиции, которые подтверждены пользователем (decision keep/cut/negotiate) ИЛИ имеют confidence high/medium/manual. Undecided + low НЕ входят в recurring (T-06: одиночный годовой $120 = low, не «доказанная подписка»).
- reported: max(0, oldPrice − reportedNewPrice) × mult — отрицательной экономии быть не может.
- Добавь тесты на оба случая.
- shadcn перенеси в devDependencies.

2. parse.ts (полностью):
- parseCsv: Papa Parse, UTF-8 с BOM/без, разделители , ; \t (автоопределение), header-строка. Лимиты: файл ≤ 5 МБ, ≤ 10 000 строк — иначе понятная ошибка.
- parsePaste: вставленный текст; поддержать CSV-подобные строки и строки вида "2026-10-03 NETFLIX.COM 8844 -15.49" (дата, описание, сумма в конце). Вернуть RawRow[] с колонками Date/Description/Amount.
- applyMapping: даты YYYY-MM-DD и MM/DD/YYYY; суммы "$1,234.56", "(15.49)", "-15.49"; signConvention; debitColumn. Кредиты/входящие (payroll) не становятся расходами. Refund (положительная сумма у мерчанта с расходами, или слово REFUND) → isRefund=true. Битая строка → в errors {line, reason} человеческим английским ("Invalid date", "Missing amount"), остальное продолжает парситься (FR-05). Брать только нужные колонки, остальные (account, name, balance) игнорировать.
- Экспортируй также suggestMapping(headers): ColumnMapping | null — эвристика по названиям колонок (date/posted, description/merchant/payee, amount/debit/credit, transaction id/reference).

3. normalize.ts: NETFLIX.COM 8844 → Netflix, SPOTIFY USA P3A1B2 → Spotify, PLANET FITNESS #4521 NY → Planet Fitness, COMCAST CABLE COMM 800-… → Comcast, ICLOUD.COM/BILL CA → iCloud. Удалять номера, #коды, телефоны, суффиксы .COM/USA/штаты. Небольшой словарь известных брендов + общее правило Title Case. Не склеивать разных поставщиков.

4. detect.ts — detectRecurring(txs): Expense[] строго по §7.3:
- дедуп: одинаковые date+merchant+amount+transactionId → один (T-04); без ID — не удалять, а ставить flag duplicate_candidate.
- refunds исключать из сумм (T-05).
- группировка по normalized merchant + близость суммы (±10%); интервалы weekly ~7, monthly 28–31, quarterly 90–92, yearly ~365.
- confidence: monthly 3+ при стабильной цене → high; 2 → medium; weekly 2 → low/medium; одно списание → low, frequency по эвристике или unknown (T-06).
- grocery/супермаркеты/рестораны (словарь категорий: WHOLEFDS, TRADER JOE, KROGER, WALMART, SAFEWAY, COSTCO, TARGET, рестораны) — не помечать как подписку; если похоже на периодичность — confidence low и reason "Regular store purchases — not a subscription" (T-07).
- price change → priceCents = последняя цена, flag price_increase, reason "Price changed from $X to $Y".
- reasons — короткие проверяемые английские строки ("3 charges of $15.49, ~30 days apart").
- category — простая эвристика (Entertainment, Health & fitness, Utilities, Software, Groceries, Other).
- Экспортируй pickReviewCandidates(expenses, n=3..5): Expense[] — топ по annual cost среди undecided с флагами/высокой ценой, с reason. Ничего не ставит в Cut автоматически (FR-11).
- Экспортируй analyzeTransactions(txs) → { expenses, stats: { parsed, excludedRefunds, excludedDuplicates, credits } } для счётчика на экране /audit.

5. Тесты (vitest) на синтетике: T-04, T-05, T-06, T-07, T-12, T-15 + полный прогон DEMO_TRANSACTIONS_CSV через parse→detect: Netflix/Planet Fitness/Comcast/Spotify/iCloud найдены monthly high; дубль TX-1005 не задвоен; refund исключён; AAA $120 — low; WHOLEFDS не подписка; payroll не расход. Плюс тест производительности: 1 000 строк обрабатываются < 500 мс.

6. Grok в /api/ai/action:
- xAI API OpenAI-совместимый: POST https://api.x.ai/v1/chat/completions, Authorization: Bearer XAI_API_KEY, модель из XAI_MODEL (проверь актуальное имя модели в документации xAI, по умолчанию возьми актуальную быструю модель Grok). Через fetch, без лишних SDK.
- Structured output: response_format json_schema по ActionResponse (без поля source — его ставит сервер). Ответ валидировать Zod; невалидный JSON → 1 retry → fallback. Таймаут 8 с (AbortController) → fallback. Нет ключа → fallback сразу. source: 'ai' | 'fallback'.
- Системный промпт по §10.3: Cut → обязательный body письма (+ короткие инструкции для чата поддержки в steps); Negotiate → callScript из 3–6 реплик с уточнением условий; плейсхолдеры [Account email], [Billing date], [Customer service channel]; не выдумывать телефоны, ссылки, цены конкурентов, права на возврат; refund — только вежливая просьба. Учитывать tone polite/firm. English (US).
- В LLM уходят ТОЛЬКО поля ActionRequest. Никаких логов с текстом письма/суммами. Простой rate limit в памяти: 20 запросов/мин на IP → 429.
- Улучши fallback: tone влияет на текст; для Negotiate без target — скрипт без суммы экономии (T-16).

7. Обнови docs/CONTRACT.md (новые функции, analyzeTransactions, suggestMapping, pickReviewCandidates) и .env.example.

Готовность: test/typecheck/lint/build зелёные, коммит "feat: import, detection, grok action".
В ОТВЕТЕ: список изменений, вывод тестов (сколько и какие T-xx покрыты), пример реального ответа /api/ai/action с source 'ai' (если ключ есть в .env.local) и с source 'fallback', отступления от промпта.
