# FamilyCut — дизайн

Эталон стиля: `docs/design/landing.png` (макет из Google Stitch). Остальные экраны делать в том же стиле по описаниям ниже.

## Токены
| Токен | Значение |
|---|---|
| bg | #F7F6F2 (тёплый off-white) |
| surface | #FFFFFF, border 1px #E7E5DF, без тяжёлых теней |
| ink / ink-muted | #1C1917 / #57534E |
| primary (кнопки, ссылки) | #14532D |
| savings accent (ТОЛЬКО суммы экономии и прогресс) | #16A34A на #DCFCE7 |
| chip Keep | серый нейтральный |
| chip Cut | #B91C1C на #FEE2E2 |
| chip Negotiate | #B45309 на #FEF3C7 |
| chip Not recurring | outline серый |
| confidence high/medium/low | нейтральные pills, не тревожные цвета |

- Шрифты: заголовки Bricolage Grotesque (tight tracking), текст Inter. Деньги — `tabular-nums`.
- Радиусы: карточки 12px, инпуты 8px, чипы pill. Сетка 8px.
- Mobile 360–430px: карточки вместо таблиц, тап-зоны ≥ 44px, без горизонтального скролла.

## Правки к макету лендинга (не переносить из Stitch)
- Убрать "· 2024" и "Annual Vacation Budget" → цель называется "Family trip".
- Убрать "Zero data sold", "direct links", "Instantly export" — это не P0 / непроверенные обещания.
- Footer: только "Not financial or legal advice. Review details before acting." + ссылка Delete my data.

## Экраны

### / (Landing) — см. landing.png
Header (wordmark, How it works, Try demo) → Hero (headline/sub из ТЗ §9.1, Start free audit, Try demo, lock-строка) → карточка результата "Sample data" → How it works (3 шага) → privacy band (текст §9.1) → footer.

### /audit — шаг 1 "Add expenses"
- Степпер: 1 Add expenses → 2 Review → 3 Act.
- Заголовок "Add your recurring expenses", подпись "Use any method. Nothing is uploaded — it's processed in your browser."
- Табы: Add manually | Paste transactions | Upload CSV.
  - Manually: строки-формы merchant, price $, frequency (weekly/monthly/quarterly/yearly), category; добавить/удалить/редактировать (≥10 строк).
  - Paste: textarea с placeholder-примером строк.
  - CSV: drop zone (UTF-8, ≤5 MB) → карточка Column mapping: Date / Description / Amount / (Transaction ID, опц.) + радио "Debits are: negative numbers / positive numbers". Подпись "Account numbers, names and balances are ignored."
- Предпросмотр строк (на мобиле — карточки): статусы ✓, "Invalid date — fix or skip" (amber), "Refund — excluded", "Duplicate — excluded".
- Счётчик "42 valid rows · 1 needs attention · 2 excluded".
- Нижняя sticky-панель: "Try demo data" (текстовая) слева, primary "Analyze expenses" справа.
- Состояния: Empty (подсказка + sample), Loading (короткие шаги анализа), Partial, Error + Retry.

### /results — шаг 2 "Review"
- Заголовок + тег "Sample data" в демо.
- Три отдельные метрики-карточки (не смешивать!):
  - "Recurring spend / year" — нейтральный ink.
  - "Potential annual savings (estimate)" — единственная зелёная.
  - "Self-reported annual savings (not bank-verified)".
- Слева: полоса "Review first" — 3–5 карточек-кандидатов с reason (подсветка, без автоматического Cut). Список "Recurring expenses (N)" с фильтрами All / Undecided / Cut / Negotiate / Keep. Карточка расхода: merchant, цена/период, годовой эквивалент, badge частоты, confidence pill, reason; сегмент-контрол Keep | Cut | Negotiate | Not recurring; при Negotiate — инлайн-инпут "Target price $__ / mo" и "Saves $X/yr" (без target — "Add a target price to estimate savings"); на Cut/Negotiate кнопка "Get script →". Редактирование названия/цены/частоты inline.
- Справа (sticky; на мобиле — под метриками): "Family goal" — имя, сумма, прогресс-бар "Your planned cuts could cover 48% of your family trip" + отдельный тонкий "Self-reported progress X%". Primary "Open action plan (N)".

### /action (или modal) — шаг 3 "Act"
- Слева список выбранных действий со статусами (на мобиле — селект/табы сверху).
- Для выбранного: строка-сводка "You pay $75.00/mo · Target $60.00/mo · Potential $180.00/yr (estimate)".
- Табы "Email" | "Phone / chat script" (Cut → по умолчанию Email, Negotiate → Script).
- Карточка текста; плейсхолдеры [Account email], [Billing date] подсвечены чипами. Тег источника: "Written by AI · review before sending" или "Template".
- Большая "Copy" (состояние Copied ✓), "Regenerate", тумблер тона Polite / Firm.
- Steps (чек-лист) и Limitations ("You must contact the provider yourself. FamilyCut does not cancel or negotiate on your behalf.").
- Статус: Not started | Attempted | Completed; при Completed — инпут "New price you got: $__/mo" (для Cut = 0) + подпись "Counts as self-reported savings (not bank-verified)".
- Loading-скелет при запросе AI; при ошибке тихо показываем fallback-шаблон.
