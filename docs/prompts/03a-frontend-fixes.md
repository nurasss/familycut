Этап 2A принят: сборка, lint и путь demo → results → action → Copy работают, на 375px горизонтального скролла нет. ЭТАП 3A — исправления по ревью. Владение файлами прежнее (src/app/** кроме api, src/components/**). Параллельно backend делает 3B.

КРИТИЧНО (нарушает ТЗ §8.1, §8.2):
1. src/components/action/action-workspace.tsx — заявленная экономия (self-reported) появляется без ввода пользователя. Сейчас при нажатии Completed у Negotiate поле "New price you got" заполняется targetPriceCents, и оно сразу сохраняется как reportedNewPriceCents. Так reported = $300, хотя пользователь ничего не подтверждал. Вдобавок ввод при клике дописывается к "95.00", и введённое значение теряется.
   Как должно быть:
   - Cut → Completed: новая цена = 0 (так в ТЗ), поле можно показать read-only "$0.00 (cancelled)".
   - Negotiate → Completed: поле ПУСТОЕ, placeholder — целевая цена ("e.g. 95.00"). Пока поле пустое, вызывать setActionStatus(id, 'completed') без reportedNewPriceCents и показывать подсказку "Enter the new price to count self-reported savings". Сохранять только валидное введённое значение.
   - Если новая цена больше текущей или равна ей, писать "No savings at this price", без ошибки.
   - Проверь вручную: Verizon $120, target $95, Completed, ввод 100 → Reported $240.00/yr.

ДОСТУПНОСТЬ / UX:
2. /audit, вкладка Paste: у textarea нет label, сейчас доступное имя берётся из placeholder. Добавь видимый <label> или aria-label "Paste transactions".
3. /audit, превью кандидатов: показывай все reasons через " · ", как на /results (сейчас видна только первая, а "Price changed…" и "Regular store purchases — not a subscription" скрыты).
4. Позиции с confidence 'low' и решением undecided на /results показывай как свёрнутую группу "Needs your review (N)" с подписью "Not counted in recurring spend until you confirm". Иначе пользователь не поймёт, почему Kroger виден в списке, но не входит в $ recurring.
5. "Delete my data" после подтверждения: дополнительно сбрось локальное состояние вкладок /audit (вставленный текст, загруженный файл), а не только store.
6. Проверь T-13 на /audit во вкладке CSV и в диалоге Delete при 360px: никаких обрезанных кнопок.

STRETCH (только когда 1–6 готовы и проверены): кнопка "Print / Save as PDF" на /action и /results через window.print() + @media print стили (одна колонка, без header/footer-кнопок, суммы и тексты как в UI). Это ТЗ §02: PDF как быстрый stretch goal.

ГОТОВНОСТЬ: typecheck/lint/build зелёные, коммит "fix(ui): review fixes" (только свои файлы).
В ОТВЕТЕ: что исправлено (по пунктам 1–6), результат ручной проверки пункта 1 с цифрами, сделан ли stretch.
