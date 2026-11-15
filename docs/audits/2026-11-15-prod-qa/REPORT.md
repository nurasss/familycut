# Отчёт полного ручного QA: FamilyCut (Этап 13A)

## 1. Шапка аудита

| Параметр | Значение |
|---|---|
| Дата | 2026-11-15 |
| Проверяемый URL | https://familycut.vercel.app |
| Коммит / ветка | `3bb64ba` (ветка `main`) |
| Браузер | Google Chrome / Headless `Chrome/157.0.0.0` (управление через `chrome-devtools` MCP; HTTP-тесты API через `curl`) |
| ОС | macOS 13.7.8 (`BuildVersion 22H730`) |
| Источник требований | `docs/TZ.md` (`T-01…T-16`, `FR-01…FR-15`), `docs/CONTRACT.md` |
| Ограничения данных и среды | Только синтетические данные; код проекта не изменялся; лимит AI (`20 req/min/IP`) соблюдён; каждый сценарий начинался в чистом `isolatedContext` |

---

## 2. Таблица результатов сценариев `S1…S17`

| ID | Сценарий | Статус | Доказательство (фактические значения и наблюдения) |
|---|---|---|---|
| **S1** | Лендинг `/` | **PASS** | `1280×800` `scrollWidth === 1280`, `0` ошибок/предупреждений в Console, `18` запросов `200`, все `a[href]` (`/`, `#how-it-works`, `/audit`) валидны, оба CTA работают, тексты приватности прямо уточняют отправку summary-полей одного счёта для AI *(побочный баг возврата `Back` после `#how-it-works` вынесен в Находку #4)* |
| **S2** | Try demo → `/results` → `/action` | **FAIL** | Метрики демо совпали: `$1,769.52` / `$725.76` / `$0.00`, `Family trip · $1,500.00` (`48%`), переключатели `Polite`/`Firm`, метки `Template` → `Written by AI · review before sending`, `Copy` → `Copied ✓`, Console чистая; **но** вкладка `Email` для `Negotiate` рендерит телефонный скрипт с `Subject:`, `Phone / chat script` для `Cut` рендерит email-письмо, а AI-чеклист утёк строкой `"callScript"` (Находка #5) |
| **S3** | Paste: 3 строки Netflix | **PASS** | Для обоих форматов (`YYYY-MM-DD` 2026-08-03..10-03 и `MM/DD/YYYY`, сумма `-15.49`): `3 valid rows · 0 needs attention · 0 excluded`, `Netflix $15.49/mo $185.88/yr High confidence` → `/results`: `$185.88`, `0` ошибок в Console *(на `1280×652` нижняя панель перекрыла кнопки до прокрутки — Находка #1)* |
| **S4** | Ручной ввод (10 счетов, правка, удаление) | **PASS** | 10 позиций (2 weekly, 4 monthly, 2 quarterly, 2 yearly) = `520,612 ¢` (`$5,206.12`); правка `Fiber Internet` `$75→$65/mo` = `508,612 ¢` (`$5,086.12`); удаление `Weekly Meal Box` `$49.99/wk` = `248,664 ¢` (`$2,486.64`); точное совпадение в центах, `0` ошибок в Console |
| **S5** | CSV `a`–`i` (9 синтетических файлов) | **PASS** | Через `DataTransfer` в `<input type="file">`: `s5a` (BOM+`,`+`TXN-QA-*`, `$540 + $185.88`), `s5b` (`;`), `s5c` (`\t`), `s5d` (`Debit/Credit`, кредиты исключены), `s5e` (ошибки строк `3–8` с номерами), `s5f` (refund исключён, `$185.88` не завышено), `s5g` (дубль исключён, `low` в `Needs your review (1)` не стал `Cut`), `s5h` (`99,208 B`, 2000 строк: `629 ms`, `143` кандидата → `/results` `$21,088.56`), `s5i` (`5,345,332 B` > 5 МБ отклонён ошибкой `File exceeds the 5 MB limit...`), `0` ошибок в Console *(см. Находку #8)* |
| **S6** | Приватность (`localStorage` и Network) | **PASS** | После `s5a` в `localStorage['familycut:audit:v1']` нет подстрок `TXN-QA` (`transactionIds: []`); тело `POST /api/ai/action` содержит строго `{merchant, action, frequency, currentPriceCents, tone}` (и опционально `targetPriceCents`), без ID, дат, сырых строк и списка счетов; других запросов с данными пользователя нет |
| **S7** | Решения, статусы и метрики `/results` и `/action` | **PASS** | 3 счёта (`$1,229.76`): `Keep` (`$0` potential), `Cut` planned (`$185.88`), `Negotiate` без target (`$0` potential, `Open action plan` / `Get script` активны), `Not recurring` снижает Recurring до `$1,085.88`; target `$60` для `Internet` → `$180.00/yr` (Potential `$365.88`); на `/action` `Cut completed` → `$185.88/yr` self-reported (`$0.00 (cancelled)`), `Negotiate completed` (`$62`) → `$156.00/yr`; итоги `/results`: `$1,229.76` / `$365.88` / `$341.88` |
| **S8** | Семейная цель | **PASS** | Создание `Emergency fund · $1,000.00` → `37%` (`365.88/1000`), изменение до `$500.00` → `73%` (`365.88/500`), удаление цели, повторное создание `$500.00` после `S7` → `73%` planned / `68%` self-reported (`341.88/500`) |
| **S9** | Persist после reload и невалидный `/action?id=` | **PASS** | После reload `/results` сохранились суммы (`$1,229.76` / `$365.88` / `$341.88`), цель `$500.00`, решения, target `60.00` и статусы в `localStorage`; `/action?id=nonexistent-qa-id` корректно отображает `Expense not found` с кнопками возврата, `0` ошибок в Console |
| **S10** | Delete my data | **PASS** | `Delete my data` → модальное подтверждение → редирект на `/`, `localStorage` полностью очищен (`[]`), переход и reload `/results` показывают пустое состояние `No expenses in this audit yet`, `0` ошибок в Console |
| **S11** | Try demo поверх данных пользователя | **PASS** | При `User Gym ($40.00/mo)` вызов `Try demo` (шапка `/audit`, футер `/audit`, шапка `/results`) открывает диалог `Replace your current saved audit with demo data?`; `Cancel` и `Escape` закрывают окно, возвращают фокус и сохраняют `User Gym ($480.00/yr)`, `0` ошибок в Console |
| **S12** | Сбой AI (`Offline`) | **PASS** | При `emulate(networkConditions: "Offline")` `POST /api/ai/action` падает с `net::ERR_INTERNET_DISCONNECTED`, надпись `Refining draft…` исчезает, отображается готовый локальный шаблон с бейджем `Template`, `Copy` → `Copied ✓`; JS-падений нет |
| **S13** | Адаптив (`360, 375, 390, 430, 1280` px) | **FAIL** | Горизонтального переполнения нет на всех 20 проверках (`scrollWidth === innerWidth`), скриншоты `375 px` сняты; **но** пункт `1 Add expenses` в степпере усекается в `Add exp...` на мобильных (`<=430 px` на `/audit`, `<=390 px` на `/results` и `/action`), а липкая нижняя панель `/audit` накрывает нижние поля/кнопки до скролла (Находки #1, #9) |
| **S14** | Доступность (клавиатура + Lighthouse) | **BLOCKED** | Клавиатурное прохождение `S2` (`Tab`/`Shift+Tab`/`Enter`/`Space`/`Escape`, фокус `2px solid rgb(20, 83, 45)`, подписи полей, фокус-трап модалок) и Lighthouse `Accessibility=100`, `Best Practices=100`, `SEO=100` пройдены; **но** числовой балл Lighthouse **Performance** недоступен (исключён из `lighthouse_audit` MCP, CLI `lighthouse` не установлен). Через Trace зафиксирован `CLS 0.487`–`0.59` и `LCP 3101 ms` на `/results` (Находка #3) |
| **S15** | Безопасность (заголовки и `/api/ai/action`) | **FAIL** | На `/` присутствуют `CSP`, `HSTS`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, нет `x-powered-by`; `GET /api/ai/action → 405`; плохие тела (`{}`, битый JSON, `-100`, `"destroy"`, 100 КБ → `400` без стектрейса); **но** запрос с лишним полем (`extraField: "hack"`) вернул `200` (`source: "ai"`) вместо `400` (Находка #6) |
| **S16** | Печать (`Print / Save as PDF`) | **BLOCKED** | Через `window.print()`-шпион, разбор `@media print` и аудит `.no-print` подтверждены сокрытие навигации/шапки и **P1-ограничение** `/action` (печатается только 1 активный счёт и 1 активная вкладка, а переключатели пилюль остаются видимыми — Находка #7); **но** визуальный диалог печати ОС не может быть открыт или сфотографирован в `chrome-devtools` MCP |
| **S17** | Производительность (`Try demo → /results`) | **PASS** | Чистый замер перехода `Try demo → /results` в Performance Trace: `clickToRouteMs: 399.7 ms`, `clickToRenderMs: 408.1 ms`, trace `LCP: 520 ms`, `INP: 103 ms`, `CLS: 0.00` (меньше 2000 ms, `0` ошибок в Console) |

---

## 3. Найденные дефекты (по убыванию серьёзности)

> **Blocker:** `0` находок. Критических сбоев сохранения данных, утечек сырых банковских строк на сервер или падений приложения не выявлено.

### Major

#### [Major #1] Нижняя липкая панель на `/audit` перекрывает кнопки и поля формы до прокрутки
- **Страница и viewport:** `/audit` (вкладка `Paste transactions` при `1280×652`; вкладка `Add manually` при `360×800`, `375×812`, `390×844`), `scrollY = 0`.
- **Шаги воспроизведения:**
  1. Открыть `/audit` в чистом окне браузера (`1280×652` на экране ноутбука или `375×812` на мобильном).
  2. На десктопе перейти на `Paste transactions` (либо остаться на `Add manually` на мобильном) без прокрутки страницы.
- **Ожидание:** Все кнопки действий (`Paste sample rows`, `Preview pasted rows`) и выпадающие списки формы целиком видны над нижней панелью и нажимаются сразу.
- **Факт:** Фиксированная панель (`Try demo data` / `Analyze expenses`, `y = 596..640` при `1280×652`) наполовину перекрывает кнопки `Paste sample rows` и `Preview pasted rows` (`y = 562.5..606.5`) и перехватывает клики по нижней части кнопок; на `375×812` перекрывает нижнюю часть селектора `Frequency` / `Category`.
- **Скриншоты:**
  - `docs/audits/2026-11-15-prod-qa/bug-audit-sticky-overlap-1280.png`
  - `docs/audits/2026-11-15-prod-qa/s13-audit-375.png`
- **Консоль / сеть:** Ошибок нет.
- **Предполагаемый файл в коде:** `src/app/audit/page.tsx:358` (`sticky bottom-0 z-20`), отступы контента/кнопок в `src/components/audit/import-tab.tsx:565-584`.

#### [Major #2] Неработающий `lg:sticky` правого сайдбара и перекрытие блока цели/кнопки Action Plan липкой шапкой на `/results`
- **Страница и viewport:** `/results`, desktop `1280×800` (при прокрутке списка расходов, `scrollY = 558..671.5`).
- **Шаги воспроизведения:**
  1. Открыть `/results` с несколькими расходами (например, после `S7` с 3 счетами и заданной целью).
  2. Прокрутить страницу вниз к нижней карточке расходов.
- **Ожидание:** Правая панель `Family goal` и кнопка `Open action plan` остаются корректно ниже шапки (`130px`) либо не попадают в активную область перехвата кликов под шапкой.
- **Факт:** Родительский grid-контейнер использует `items-start`, из-за чего колонка `lg:col-span-4` имеет высоту самого блока `<aside>` и свойство `lg:sticky lg:top-32` на карточке цели не удерживает её при прокрутке. В результате заголовок цели (`y = 29..73`) и кнопка `Open action plan (1)` (`y = 13.5`) уезжают под полупрозрачный `sticky` `<header>` (`y = 0..130`), визуально размываются под ним, а клик перехватывается шапкой (`elementFromPoint` возвращает `<header>`).
- **Скриншот:** `docs/audits/2026-11-15-prod-qa/bug-results-sticky-header-overlap.png`
- **Консоль / сеть:** Ошибок нет.
- **Предполагаемый файл в коде:** `src/app/results/page.tsx:190-197`, `src/components/results/family-goal-card.tsx:65`, `src/components/layout/site-header.tsx:33`.

#### [Major #3] Высокий сдвиг макета (`CLS 0.487`–`0.59`) и медленный холодный `LCP 3101 ms` на `/results` с сохранёнными данными
- **Страница и viewport:** `/results` (данные демо-аудита), desktop `1280×800` и mobile.
- **Шаги воспроизведения:**
  1. Загрузить демо-данные, перейти на `/results`.
  2. Выполнить холодную перезагрузку `/results` с трассировкой (`performance_start_trace`, `ignoreCache: true`) или запустить `lighthouse_audit`.
- **Ожидание:** Минимальный сдвиг макета (`CLS <= 0.1`) и быстрый `LCP` при отрисовке сохранённого аудита.
- **Факт:** При SSR и до клиентской гидратации рендерится skeleton-состояние (`!hydrated`), высота которого не соответствует итоговому отчёту с 3 метриками, целью и списком карточек. После чтения `localStorage` происходит скачок всего контента (`CLSCulprits` в интервале `2,977–3,977 ms` с вкладом `0.5914` на основной `lg:grid-cols-12` сетке и футере). Итоги замеров: Chrome Trace `LCP 3101 ms` (`TTFB 106 ms` + `Render delay 2,995 ms`), `CLS 0.59`; в Lighthouse провален аудит `cumulative-layout-shift` — `0.487` (desktop, балл `0.17`, `Agentic Browsing 59`) и `0.372` (mobile, балл `0.28`, `Agentic Browsing 64`).
- **Консоль / сеть:** Ошибок нет.
- **Предполагаемый файл в коде:** `src/app/results/page.tsx:75-85`.

---

### Minor

#### [Minor #4] Возврат кнопкой `Back` после `#how-it-works → /audit` меняет URL на `/#how-it-works`, но оставляет DOM на `/audit`
- **Страница и viewport:** `/` → `/#how-it-works` → `/audit` → `Back`, `1280×800`.
- **Шаги воспроизведения:**
  1. Открыть `/`, нажать ссылку `How it works` (переход к `/#how-it-works`).
  2. Нажать `Start free audit` (переход на `/audit`).
  3. Нажать кнопку `Back` браузера.
- **Ожидание:** Открывается главная страница `/` у секции `#how-it-works`.
- **Факт:** `location.href` становится `https://familycut.vercel.app/#how-it-works` (`pathname: "/"`, `hash: "#how-it-works"`), но содержимое страницы остаётся экраном `/audit` (`h1: "Add your recurring expenses"`).
- **Скриншот:** `docs/audits/2026-11-15-prod-qa/bug-back-hash-stuck.png`
- **Консоль / сеть:** Ошибок нет.
- **Предполагаемый файл в коде:** `src/components/layout/site-header.tsx:52` (обычная ссылка `<a href="#how-it-works">` на странице `/`).

#### [Minor #5] На `/action` вкладки `Email` и `Phone / chat script` смешивают формат контента, а AI-чеклист утёк именем `"callScript"`
- **Страница и viewport:** `/action`, `1280×800` и `360×800`.
- **Шаги воспроизведения:**
  1. Открыть `/action` в демо-режиме (или со своими `Cut` и `Negotiate` счетами).
  2. На `Internet Provider` (`Negotiate`) выбрать вкладку `Email`.
  3. На `Streaming A` (`Cut`) выбрать вкладку `Phone / chat script`.
  4. Проверить пункты чеклиста `Steps to follow` у `Internet Provider` (`Negotiate`, тон `Firm`) после ответа AI.
- **Ожидание:** Вкладка `Email` содержит письмо для электронной почты, `Phone / chat script` — реплики для звонка/чата, а шаги чеклиста формулируются естественным языком без имён внутренних полей JSON.
- **Факт:**
  - Для `Negotiate` модель/шаблон заполняет `callScript` и оставляет `body: null`, поэтому в UI на вкладке `Email` подставляется телефонный скрипт (`"Hi, I'm calling..."`) вместе с синтетическим заголовком `Subject: Billing review request: Internet Provider`.
  - Для `Cut` наоборот (`callScript: null`), поэтому на вкладке `Phone / chat script` отображается полное письмо (`"Dear Streaming A Support... [Your name]\n[Account email]"`) с отрезанным `Subject:`, при этом инструкция указывает: `"Paste or type the email text above into the chat window."`.
  - В AI-ответе для `Internet Provider` (`Negotiate`, `Firm`) в списке шагов появилась строка `"State the callScript lines exactly."`.
- **Консоль / сеть:** `POST /api/ai/action` вернул `200`, `source: "ai"`, консольных ошибок нет.
- **Предполагаемый файл в коде:** `src/components/action/action-workspace.tsx:211-225`, системный промпт генерации шагов в `src/lib/ai/grok.ts`.

#### [Minor #6] `POST /api/ai/action` принимает неизвестные лишние поля со статусом `200` вместо `400`
- **Страница / эндпоинт:** `POST https://familycut.vercel.app/api/ai/action`.
- **Шаги воспроизведения:** Отправить валидный payload с посторонним ключом `extraField`:
  `curl -sS -X POST https://familycut.vercel.app/api/ai/action -H 'Content-Type: application/json' -d '{"merchant":"Netflix","action":"cut","frequency":"monthly","currentPriceCents":1549,"tone":"polite","extraField":"hack"}'`
- **Ожидание:** Отклонение со статусом `400` (`invalid_request`) без стектрейса.
- **Факт:** Эндпоинт вернул `HTTP 200` и сгенерировал ответ (`"source":"ai"`).
- **Причина в коде:** `src/lib/schemas.ts:11-18` (`actionRequestSchema = z.object({...})` не использует `.strict()`).

#### [Minor #7] Неполный печатный отчёт на `/action` (P1-ограничение) и отображение интерактивных переключателей в печати
- **Страница и viewport:** `/action` и `/results`, `@media print`.
- **Шаги воспроизведения:** Нажать `Print / Save as PDF` (либо проинспектировать `.no-print` классы в DOM и правила `@media print`).
- **Ожидание:** Полная распечатка выбранных действий без интерактивных управляющих кнопок/пилюль.
- **Факт:** Зафиксировано **P1-ограничение**: на `/action` панель очереди `ASIDE` (`Your action queue`) и мобильный `<select>` скрыты `.no-print`, поэтому печать выводит только один текущий счёт и только одну открытую вкладку (`Email` или `Phone / chat script`). Кроме того, группы переключателей (`Polite/Firm`, `Email/Phone`, `Not started/Attempted/Completed` на `/action`; `Keep/Cut/Negotiate/Not recurring` на `/results`) не имеют `.no-print` и печатаются как элементы управления.
- **Предполагаемый файл в коде:** `src/components/action/action-workspace.tsx:895, 925` и блоки радио/табов без `.no-print`; `src/components/results/expense-card.tsx`.

#### [Minor #8] При отклонении CSV > 5 МБ интерфейс всё равно отображает `Loaded: s5i_over5mb.csv`
- **Страница и viewport:** `/audit` (`Upload CSV`), `1280×800`.
- **Шаги воспроизведения:** Выбрать файл `docs/audits/2026-11-15-prod-qa/csv/s5i_over5mb.csv` (`5,345,332 B`).
- **Ожидание:** Состояние файла в зоне загрузки не должно сообщать об успешной загрузке (`Loaded: ...`), если файл отклонён до чтения.
- **Факт:** Над красным предупреждением `Unable to process transactions — File exceeds the 5 MB limit. Split the export and try again.` отображается `Loaded: s5i_over5mb.csv`, так как `setFileName(file.name)` выполняется раньше проверки `file.size > MAX_FILE_BYTES`.
- **Предполагаемый файл в коде:** `src/components/audit/import-tab.tsx:481-486`, `610-613`.

---

### Cosmetic

#### [Cosmetic #9] Усечение текста `"Add exp..."` в верхнем степпере на мобильных ширинах
- **Страница и viewport:** `/audit` (`360, 375, 390, 430` px), `/results` и `/action` (`360, 375, 390` px).
- **Факт:** Подпись шага 1 `<span className="truncate">Add expenses</span>` обрезается в `Add exp...` (`clientWidth 55..67 px` против `scrollWidth 82 px`), а нижняя полоса активного шага (`inset-x-3 bottom-0`) упирается прямо в нижнюю рамку скруглённой пилюли.
- **Скриншоты:** `docs/audits/2026-11-15-prod-qa/s13-audit-375.png`, `docs/audits/2026-11-15-prod-qa/s13-results-375.png`, `docs/audits/2026-11-15-prod-qa/s13-action-375.png`
- **Предполагаемый файл в коде:** `src/components/layout/site-header.tsx:123-128`.

#### [Cosmetic #10] Отсутствие ссылки `Skip to main content` на `/` и мелкие нюансы заголовков ответа
- **Страница / проверка:** `/` (`S14`, `S15`).
- **Факт:** Первый `Tab` на `/` попадает на ссылку логотипа `FamilyCut` без ссылки пропуска навигации (`Skip to main content`). В HTTP-заголовках главной страницы присутствуют `script-src 'self' 'unsafe-inline'` (стандартно для Next.js без nonce) и `access-control-allow-origin: *` на HTML; все обязательные security-заголовки из требований на месте.

---

## 4. Баллы Lighthouse и замеры CWV (Performance Trace)

| Страница / профиль | Accessibility | Best Practices | SEO | Performance (`lighthouse_audit` MCP) | Agentic Browsing | CWV (Chrome Performance Trace) |
|---|---:|---:|---:|---|---|---|
| `/` (Desktop) | **100** | **100** | **100** | *Исключено в MCP* | **100** (`48 passed, 0 failed`) | `LCP 580 ms` (`TTFB 91 ms + Render delay 488 ms`), `CLS 0.00` |
| `/` (Mobile) | **100** | **100** | **100** | *Исключено в MCP* | **100** (`48 passed, 0 failed`) | — |
| `/results` с Demo (Desktop) | **100** | **100** | **100** | *Исключено в MCP* | **59** (`51 passed, 1 failed`: `CLS = 0.487`, score `0.17`) | Cold reload: `LCP 3101 ms` (`TTFB 106 ms + Render delay 2,995 ms`), `CLS 0.59` |
| `/results` с Demo (Mobile) | **100** | **100** | **100** | *Исключено в MCP* | **64** (`51 passed, 1 failed`: `CLS = 0.372`, score `0.28`) | — |
| Переход `Try demo → /results` (`S17`) | — | — | — | — | — | `clickToRouteMs: 399.7 ms`, `clickToRenderMs: 408.1 ms`, trace `LCP 520 ms`, `INP 103 ms`, `CLS 0.00` |

---

## 5. Что не удалось проверить и почему

1. **Числовой балл Lighthouse Performance (0–100) на `/` и `/results` (S14):** инструмент `lighthouse_audit` из `chrome-devtools` MCP намеренно не включает категорию `performance`, а отдельный CLI `lighthouse` в системе не установлен. Вместо него сняты `performance_start_trace` метрики `LCP`/`CLS`/`INP` и зафиксирован провал аудита `cumulative-layout-shift` в разделе `Agentic Browsing` на `/results`.
2. **Визуальный системный диалог `Print / Save as PDF` (S16):** `chrome-devtools` MCP не может открыть, управлять или снять скриншот с нативного диалога печати macOS/Chrome, а `emulate` не предоставляет опции `media: "print"`. Печатный режим проверен через перехват `window.print()`, чтение правил `@media print` и аудит классов `.no-print` в DOM.
3. **Прямое чтение буфера обмена `navigator.clipboard.readText()` (S2, S12, S13):** вызов `readText()` в управляемом Chromium поднимает системный permission prompt и блокирует MCP. Факт копирования подтверждён выполнением `handleCopy()` без исключений и видимым переключением кнопки в `Copied ✓`.
4. **Нативный выбор файла через `upload_file` MCP (S5):** инструмент `upload_file` отклонил путь к `docs/audits/2026-11-15-prod-qa/csv/*.csv` с ошибкой `Access denied` (вне разрешённого корня MCP). Все 9 синтетических CSV-файлов проверены передачей точных `new File(...)` через `DataTransfer` и событие `change` на `<input type="file">`.

---

## Приложение A. Контрольные расчёты `S4` и артефакты `S5`

### Разблюдовка расчёта `S4` в центах
- Начальные 10 счетов:
  - Weekly: `$5.00 × 52 = 26,000 ¢`; `$49.99 × 52 = 259,948 ¢`
  - Monthly: `$15.49 × 12 = 18,588 ¢`; `$11.99 × 12 = 14,388 ¢`; `$75.00 × 12 = 90,000 ¢`; `$29.99 × 12 = 35,988 ¢`
  - Quarterly: `$45.00 × 4 = 18,000 ¢`; `$89.50 × 4 = 35,800 ¢`
  - Yearly: `$99.00 × 1 = 9,900 ¢`; `$120.00 × 1 = 12,000 ¢`
  - **Итого (10 позиций):** `520,612 ¢` = **`$5,206.12`** (совпало с `/results`).
- Правка `Fiber Internet` с `$75.00` до `$65.00/mo`: `520,612 - 12,000 = 508,612 ¢` = **`$5,086.12`** (совпало с `/results`).
- Удаление `Weekly Meal Box` (`$49.99/wk`): `508,612 - 259,948 = 248,664 ¢` = **`$2,486.64`** (совпало с `/results`).

### Тестовые CSV в `docs/audits/2026-11-15-prod-qa/csv/`
- `s5a_bom_txnid.csv` (`327 B`) — UTF-8 BOM, запятая, колонка `Transaction ID` (`TXN-QA-001…`)
- `s5b_semicolon.csv` (`180 B`) — разделитель `;`
- `s5c_tabs.csv` (`195 B`) — разделитель `\t`
- `s5d_debit_credit.csv` (`277 B`) — раздельные колонки `Debit`/`Credit` с возвратом и доходом
- `s5e_errors.csv` (`274 B`) — пустые обязательные поля и битая строка (ошибки на строках `3–8`)
- `s5f_refund.csv` (`143 B`) — возврат `Netflix` наряду с регулярными списаниями
- `s5g_duplicate_and_low.csv` (`247 B`) — дубль транзакции и единичная годовая транзакция с низкой уверенностью
- `s5h_2000rows.csv` (`99,208 B`, `2001` строка / `2000` транзакций) — проверка производительности парсинга и отсутствия утечки `TX-2K-*`
- `s5i_over5mb.csv` (`5,345,332 B`) — проверка отказа при превышении лимита 5 МБ

### Скриншоты в `docs/audits/2026-11-15-prod-qa/`
- `s1-landing-1280.png`
- `bug-audit-sticky-overlap-1280.png`
- `bug-results-sticky-header-overlap.png`
- `bug-back-hash-stuck.png`
- `s13-home-375.png`
- `s13-audit-375.png`
- `s13-results-375.png`
- `s13-action-375.png`
