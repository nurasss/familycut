# Отчёт юзабилити-теста «новый пользователь без подсказок» (ЭТАП 15A)

- **Дата:** 2026-11-15
- **Продукт:** https://familycut.vercel.app
- **Роль:** Обычный американский родитель 35 лет, впервые на сайте (без знания кода, документации и подсказок).
- **Устройство:** Эмуляция мобильного телефона `390×844` (deviceScaleFactor 2, `mobile`, `touch`, iPhone Safari UA); Задача 3 дополнительно повторена на desktop `1280×800`.
- **Метод:** Каждая задача начиналась с нового изолированного контекста браузера (`isolatedContext`). Замеры времени — по системным часам (`date +%s` до перехода на главную и сразу после достижения результата).

---

## 1. Сводная таблица задач

| Задача | Устройство | Время | Цель | Результат | Затыки (>10 с) |
|---|---|---:|---:|:---:|---:|
| Задача 1. Демо-экономия и копирование письма отмены | Mobile 390×844 | 43 с | < 120 с (2 мин) | PASS | 0 |
| Задача 2. Ввод 3 подписок, расчёт экономии и скрипт по интернету | Mobile 390×844 | 90 с | < 300 с (5 мин) | PASS | 1 |
| Задача 3 (Mobile). Доля отпуска $2,000 | Mobile 390×844 | 70 с (ввод: 52 с, цель: 18 с) | < 180 с (3 мин) | PASS | 0 |
| Задача 3 (Desktop). Доля отпуска $2,000 | Desktop 1280×800 | 82 с (ввод: 61 с, цель: 21 с) | < 180 с (3 мин) | PASS | 0 |
| Задача 4. Удаление всех своих данных | Mobile 390×844 | 31 с | < 60 с (1 мин) | PASS | 0 |

---

## 2. Детализация прохождения по задачам

### Задача 1 — Посмотреть демо и скопировать письмо для отмены подписки
- **Время:** `43 с` (старт `1794723801`, финиш `1794723844`) — цель `< 120 с` (**PASS**).
- **Затыки (>10 с):** `0`.
- **Путь:**
  1. Открыл главную `/` ([task1-01-landing.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task1-01-landing.png)). Уже на первом экране в карточке `Household Bill Audit` (`SAMPLE DATA`) видны годовые расходы `$1,769.52` и потенциальная экономия `$725.76`.
  2. Нажал `Try demo` → перешёл на `/results` ([task1-02-results.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task1-02-results.png)). Подтвердил экономию примерной семьи: **`$725.76`** в год (`Streaming A` `$185.88/yr`, `Fitness membership` `$359.88/yr`, `Internet Provider` `$180.00/yr`).
  3. На карточке `Streaming A` (`Cut`) нажал `Get script` → открылся `/action?id=demo-streaming-a`.
  4. Нажал `Copy` ([task1-03-action-copied.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task1-03-action-copied.png)) → кнопка переключилась на `Copied ✓` (визуально `✓ Copied ✓`).
- **Наблюдения и шероховатости:**
  - После нажатия `Try demo` переход на `/results` занял ~2 секунды без явного индикатора загрузки на кнопке — в первый миг казалось, что нажатие не сработало.
  - На `/action` при загрузке сразу показался `Template` с текстом `Subject: Cancellation request: Streaming A`, но рядом крутилось `Refining draft…`, и буквально в момент чтения/нажатия `Copy` текст сам заменился на `Written by AI · review before sending` с жёлтыми плейсхолдерами `[Account email]` и `[Your name]`.
  - В блоке `Cancellation email` есть `Subject:`, но чек-лист ниже предлагает `open the support chat` и `Paste or type the email text into the chat window`.
  - На мобильном верхний шаг `1 Add expe...` обрезается троеточием, а кнопка `Try demo` остаётся в шапке даже в демо-режиме.
- **Ошибки / числа:** Ошибок ввода не было; числа согласованы (`$185.88 + $359.88 + $180.00 = $725.76`).

### Задача 2 — Свои 3 подписки, расчёт экономии и скрипт для интернет-провайдера
- **Время:** `90 с` (старт `1794723858`, финиш `1794723948`) — цель `< 300 с` (**PASS**).
- **Затыки (>10 с):** `1`.
- **Путь:**
  1. Открыл `/` → нажал `Start free audit` → `/audit` ([task2-01-audit-empty.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task2-01-audit-empty.png)).
  2. Вручную добавил: `Netflix` (`$15.49`, Monthly, `Entertainment`), `Gym` (`$39.99`, Monthly, `Health & fitness`), `Internet` (`$80`, Monthly, `Utilities`).
  3. Нажал `Analyze expenses (3)` → `/results`.
  4. В верхнем блоке `Review first` нажал `Negotiate` для `Internet` ([task2-02-review-first-negotiate.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task2-02-review-first-negotiate.png)). Карточка исчезла из `Review first`, а сумма экономии осталась `$0.00`.
  5. Там же отметил `Gym` → `Keep` и `Netflix` → `Cut`.
  6. Пролистал вниз до `Recurring expenses (3)` → нашёл карточку `Internet`, ввёл `60` в `Target price ($ / mo)` ([task2-03-internet-target.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task2-03-internet-target.png)). Получил `Saves $240.00/yr (estimate)` и общую экономию **`$425.88`** ([task2-05-results-425.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task2-05-results-425.png)).
  7. Нажал `Get script` у `Internet` → `/action?id=...` → нажал `Copy` ([task2-04-internet-script-copied.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task2-04-internet-script-copied.png)).
- **Затык:** После выбора `Negotiate` в блоке `Review first` карточка `Internet` сразу пропадает без поля для целевой цены и без подсказки, где задать `$60`; итоговая экономия продолжает показывать `$0.00`. Пришлось искать карточку ниже в общем списке.
- **Проблема в скрипте:** Локальный шаблон сначала показывал `Hi, I’m reviewing my monthly Internet bill`, но после завершения `Refining draft…` AI-версия подставила обезличенное **`Service provider`** (`Hi, I'm calling about my monthly Service provider bill` и `You must contact Service provider yourself`), потеряв слово `Internet`.
- **Совпадение чисел:** Ожидалось `$185.88 (Netflix) + $240.00 (Internet) = $425.88/yr`. Сайт показал **`$425.88`** (`$185.88/yr` + `$240.00/yr`, общий расход `$1,625.76/yr`) — **полное совпадение**.

### Задача 3 — Какую долю отпуска $2,000 покроют сокращения

#### Вариант A: Mobile 390×844
- **Время:**
  - Повторный ввод подписок и решений из Задачи 2 (чистый изолированный контекст): `52 с` (`1794723976` → `1794724028`).
  - Установка цели отпуска `$2,000` и получение результата: `18 с` (`1794724028` → `1794724046`).
  - **Итого от открытия главной страницы до ответа:** `70 с` — цель `< 180 с` (**PASS**).
- **Затыки (>10 с):** `0`.
- **Путь:** `/` → `Start free audit` → ввод 3 подписок на `/audit` → `Analyze expenses (3)` → в `Recurring expenses (3)` выбрал `Cut` (Netflix), `Keep` (Gym), `Negotiate` + Target `60` (Internet) → нажал `Set a family goal` → заменил предзаполненные `Family trip` / `1500.00` ([task3-mobile-goal-form.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task3-mobile-goal-form.png)) на `Vacation` / `2000` → `Save goal` → увидел `Planned savings progress: 21%` / `Your planned cuts could cover 21% of your Vacation.` ([task3-mobile-goal-21pct.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task3-mobile-goal-21pct.png)).
- **Совпадение чисел:** Ожидалось `425.88 / 2000 ≈ 21%`. Сайт показал **`21%`** — **совпало**.
- **Мелкие шероховатости:** В пустой карточке `Family goal` две кнопки подряд (`Set goal` и `Set a family goal`). Сразу под `21%` видна строка `Self-reported progress 0% · Not bank-verified`, что на первый взгляд может смутить («почему 0%, если выше 21%?»).

#### Вариант B: Desktop 1280×800
- **Время:**
  - Повторный ввод подписок и решений из Задачи 2: `61 с` (`1794724070` → `1794724131`).
  - Установка цели отпуска `$2,000`: `21 с` (`1794724131` → `1794724152`).
  - **Итого от открытия главной страницы до ответа:** `82 с` — цель `< 180 с` (**PASS**).
- **Затыки (>10 с):** `0`.
- **Путь:** `/` ([task3-desktop-landing.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task3-desktop-landing.png)) → `/audit` → ввод 3 подписок → `/results` ([task3-desktop-results-before.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task3-desktop-results-before.png)) → выбор решений и `60` для Internet → справа в липкой панели `Family goal` нажал `Set a family goal` → `Vacation` / `2000` → `Save goal` → **`21%`** ([task3-desktop-goal-21pct.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task3-desktop-goal-21pct.png)).
- **Сравнение с Mobile:** На desktop 1280×800 задача ощущается удобнее: панель `Family goal` закреплена справа от списка подписок, прогресс `21%` обновляется в зоне видимости без прокрутки, а верхний степпер `1 Add expenses / 2 Review / 3 Act` не обрезается. Из мелких огрехов — в 3-колоночной сетке `Review first` кнопка `Negotiate` переносится на вторую строку под `Keep`/`Cut`.

### Задача 4 — Удалить все свои данные с сайта
- **Время:** `31 с` (старт `1794724178`, финиш `1794724209`) — цель `< 60 с` (**PASS**).
- **Затыки (>10 с):** `0` (саму кнопку нашёл быстро, но результат вызвал недоумение).
- **Путь (чистый браузер):** Открыл `/` → пролистал в самый низ к футеру → нажал `Delete my data` → открылось окно `Delete all saved audit data?` с пояснением про локальное хранилище ([task4-01-delete-modal.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task4-01-delete-modal.png)) → нажал красную кнопку `Delete my data` → модал закрылся ([task4-02-after-delete.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task4-02-after-delete.png)).
- **Дополнительная проверка при наличии данных:** После входа в демо-режим (`/results`) повторил удаление из футера. После подтверждения произошёл редирект на `/` ([task4-03-after-delete-from-results.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task4-03-after-delete-from-results.png)), но **никакого визуального подтверждения («Данные удалены») на экране не появилось** — вместо этого сразу виден блок `Household Bill Audit` (`SAMPLE DATA`) с суммами `$1,769.52` и `$725.76`, из-за чего тревожный пользователь не уверен, что его данные действительно стёрты.

---

## 3. Топ-5 проблем юзабилити по серьёзности

1. **[Major] AI-скрипт заменяет название провайдера (`Internet`) на обезличенное `Service provider`**
   - **Где:** Экран `Action plan` (`/action?id=...`), блок сгенерированного скрипта ([task2-04-internet-script-copied.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task2-04-internet-script-copied.png)).
   - **Что непонятно:** Сначала виден шаблон с корректным названием `Internet`, затем через 2 секунды AI заменяет его на `Service provider` (`my monthly Service provider bill`), что звучит странно и неестественно для реального звонка оператору.
   - **Предложение:** Передавать и сохранять введённое имя сервиса (`Internet`) в AI-шаблоне без подмены на шаблонное `Service provider`.

2. **[Major] Выбор `Negotiate` в блоке `Review first` убирает карточку без поля целевой цены**
   - **Где:** `/results`, секция `Review first` ([task2-02-review-first-negotiate.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task2-02-review-first-negotiate.png)).
   - **Что непонятно:** Нажатие `Negotiate` убирает подписку из верхнего списка, но не даёт ввести желаемую цену (`$60`) и оставляет экономию на `$0.00`, вынуждая пользователя искать карточку ниже в `Recurring expenses`.
   - **Предложение:** Давать ввод `Target price` прямо в `Review first` или автоматически прокручивать экран к полю целевой цены в основном списке.

3. **[Major] Нет визуального подтверждения после нажатия `Delete my data`**
   - **Где:** Футер `/` и `/results` после подтверждения модала `Delete all saved audit data?` ([task4-02-after-delete.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task4-02-after-delete.png), [task4-03-after-delete-from-results.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task4-03-after-delete-from-results.png)).
   - **Что непонятно:** После подтверждения окно молча закрывается (или перекидывает на главную с демо-цифрами `$1,769.52`), не сообщая пользователю, что его данные действительно удалены.
   - **Предложение:** Показывать явный тост или баннер подтверждения (`Saved audit data deleted`) после успешной очистки хранилища.

4. **[Minor] Мелкие несогласованности на экране скрипта (`✓ Copied ✓`, `email` против `support chat`, подмена текста при загрузке)**
   - **Где:** `/action` ([task1-03-action-copied.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task1-03-action-copied.png)).
   - **Что непонятно:** На кнопке копирования две галочки подряд (`✓ Copied ✓`), а под заголовком `Cancellation email` с темой письма чек-лист предлагает вставить текст в `support chat`; плюс фоновая догрузка AI-версии меняет текст прямо во время чтения.
   - **Предложение:** Убрать лишний символ `✓` из текста кнопки, согласовать термины `email` и `support chat` в чек-листе и стабилизировать момент подстановки AI-текста.

5. **[Minor] Обрезка текста степпера на мобильном и дублирующиеся кнопки действий**
   - **Где:** Шапка шагов на 390×844 ([task1-02-results.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task1-02-results.png), [task2-01-audit-empty.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task2-01-audit-empty.png)) и карточка `Family goal` ([task3-desktop-results-before.png](file:///Users/nuras/Desktop/businesscup/docs/audits/2026-11-15-usability/task3-desktop-results-before.png)).
   - **Что непонятно:** Шаг `1 Add expe...` обрезается на телефоне, кнопка `Try demo` остаётся в шапке даже во время собственного аудита, а пустая цель показывает одновременно две кнопки (`Set goal` и `Set a family goal`).
   - **Предложение:** Сократить подпись шага до `1 Add bills` и убрать дублирующие кнопки `Set goal` и `Try demo` там, где пользователь уже в сценарии.

---

## 4. Общее впечатление новичка

Как родитель, который впервые зашёл на сайт, я сразу понял, что сервис помогает выписать регулярные траты, решить, от чего отказаться или поторговаться, и получить готовый текст для провайдера без подключения банковской карты. Сайт вызывает доверие благодаря спокойному дизайну, понятному акценту на работе в браузере без регистрации и логина в банк, а также честным пометкам `Not bank-verified` и `FamilyCut does not cancel or negotiate on your behalf`. Единственное, что немного настораживает в плане доверия — тихое закрытие окна при удалении данных без подтверждающего сообщения и внезапная замена `Internet` на `Service provider` в AI-скрипте. Первым делом я бы исправил сохранение имени провайдера в скрипте, добавил явное уведомление после `Delete my data` и дал возможность сразу указать целевую цену при выборе `Negotiate` в верхнем блоке.
