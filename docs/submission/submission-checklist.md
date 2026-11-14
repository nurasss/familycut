# FamilyCut — Чек-лист сдачи проекта (Business Cup 2.0)

**Дата подготовки комплекта:** 15 ноября 2026  
**Статус:** локальная кодовая база и материалы сдачи готовы к ревью; публичный релиз, деплой и заполнение организационных полей — **TBD**.

---

## 1. Подтверждённые локальные результаты (в репозитории)

- [x] **Основной пользовательский поток P0:** `/` → `/audit` (Manual / Paste / CSV + Column Mapping + Debit/Credit) → `/results` (3 независимые метрики, Review first, Family goal) → `/action` (Email / Script, Polite / Firm, Copy, Template fallback, Completed tracking) → `Delete my data`.
- [x] **Ручная группировка F09 (Split / Merge):** принята в рамках [manual-grouping-contract.md](../design/manual-grouping-contract.md) и [2026-11-15-grouping-integration-review.md](../audits/2026-11-15-grouping-integration-review.md). Подтверждены `split`, `merge`, `undo`, `clear`, диалог подтверждения скачка цены `> 1.5x`, блокировка `Analyze` при `rejected`/`needs_confirmation`, и диалог `Replace audit`.
- [x] **Локальные автотесты (без реальных LLM-запросов, финальная приёмка release):**
  - `npm test`: **350 / 350** (12 файлов), включая бенчмарк 1 000 строк `< 500 мс`.
  - `npm run typecheck`: `exit 0`.
  - `npm run lint`: `exit 0` (в продуктовом коде и F09 предупреждений нет; 2 предупреждения `no-unused-vars` в стороннем `brag-output/work/audio.mjs`).
  - `git diff --check`: `exit 0`.
  - `XAI_API_KEY='' npm run test:e2e`: **37 / 37** (production build `.next-e2e`, 2.5 минуты), включая mobile 360/375 px, защиту demo и десять ручных записей.
- [x] **Приватность и математика:**
  - Расчёты на клиенте в целых центах USD (`src/lib/engine/money.ts`).
  - Сырой CSV и назначения F09 не сохраняются в `localStorage` и не отправляются на сервер.
  - На `POST /api/ai/action` уходят только безопасные поля одного расхода через `buildSafeActionRequest` (`merchant` из allowlist или `"Service provider"`).
  - Без `XAI_API_KEY` или при сбое модели работает локальный `Template` fallback (`src/lib/ai/fallback.ts`).
- [x] **Release-защита:** Try demo подтверждает замену реального аудита/цели; повреждённое сохранение валидируется; денежный ввод разбирается целыми центами.
- [x] **Честные границы MVP (не реализовано в P0):**
  - P1 **Sharing** (совместная ссылка партнёру с TTL и отзывом).
  - P1 **Accounts / magic link / cross-device sync**.
  - P1 **2 CSV (Partner A / Partner B)** и семейные дубли.
  - P1 **Full report PDF** (есть только базовый браузерный `Print / Save as PDF` текущего вида).
  - P1 **Reminders** и база проверенных direct links.
  - Платежи / Stripe (`$19 Action Pack` и `$79/year Family Plan` указаны только как гипотезы).

---

## 2. Материалы сдачи в `docs/submission/`

- [x] [familycut-pitch.pdf](./familycut-pitch.pdf) — PDF-питч на русском языке, 10 слайдов 16:9 (`<= 10`), без выдуманных market stats / traction, с чёткой маркировкой `Sample data` ("The Miller family") и гипотез монетизации.
- [x] [pitch-deck.html](./pitch-deck.html) и [generate-pitch.mjs](./generate-pitch.mjs) — воспроизводимый исходник HTML/CSS и скрипт генерации PDF + визуальной проверки страниц.
- [x] [speaker-script.md](./speaker-script.md) — сценарий выступления на 5 минут с поминутным таймингом и банк ответов на 2 минуты Q&A.
- [x] [demo-script.md](./demo-script.md) — сценарий короткого демо на 60–90 секунд + резервный план.
- [x] [Резервные скриншоты](./screenshots/02-results.png) — реальные экраны локальной production-сборки на синтетическом demo, включая desktop, mobile и Template. Воспроизведение: `node docs/submission/capture-demo.mjs http://localhost:3211` при запущенном локальном сервере.
- [x] [submission-checklist.md](./submission-checklist.md) — данный чек-лист сдачи.

---

## 3. Внешние шаги и TBD до публичной сдачи

> **Важно:** ссылки из `README.md` (`https://familycut.vercel.app`, `https://github.com/nurasss/familycut`) проверены read-only HTTP-запросом: оба отвечают 200, сайт открывается по HTTPS. Это не доказывает, что опубликован финальный код: локальные изменения ещё не отправлены, `commit`, `push` и `deploy` не выполнялись. См. [доказательство доступности](../audits/2026-11-15-public-availability.json).

### GitHub и код
- [ ] **TBD — Git review & clean tree:** проверить `git status` / `git diff`, решить судьбу временных/артефактных директорий (например `brag-output/`) и исключить лишние локальные файлы перед коммитом.
- [ ] **TBD — Commit & Push:** зафиксировать изменения и отправить в публичный репозиторий (`https://github.com/nurasss/familycut` — проверить фактический URL, видимость `Public`, наличие `.env.example` и отсутствие `.env.local` или секретов в истории).
- [ ] **TBD — README проверка на GitHub:** убедиться, что команды запуска, список ограничений и ссылки в `README.md` соответствуют выложенному состоянию.

### Деплой и живая проверка (Live HTTPS)
- [ ] **TBD — Vercel Deploy:** задеплоить финальный commit в Vercel (или выбранный HTTPS-хостинг).
- [ ] **TBD — Проверка Live URL:** открыть задеплоенный URL (ожидаемый из README: `https://familycut.vercel.app` — HTTP 200 подтверждён; функциональность финального deployment требует проверки) на десктопе и реальном телефоне (iOS Safari / Android Chrome), пройти путь `Try demo` → `/results` → `/action` → `Copy`, проверить `Upload CSV` + `Split/Merge` и `Delete my data`.
- [ ] **TBD — Optional AI Env (`XAI_API_KEY`):** если на живом демо нужен текст от Grok, добавить `XAI_API_KEY` только в Environment Variables хостинга (не в репозиторий), протестировать 1 реальный запрос `POST /api/ai/action` и убедиться в корректности ответа и fallback.

### Организатор Business Cup 2.0 и команда
- [ ] **TBD — Состав команды и спикер:** указать имена, роли участников и кто выступает с питчем / отвечает на Q&A.
- [ ] **TBD — Регламент и форма сдачи:** подтвердить у организаторов точный дедлайн (в ТЗ D упоминалось 15 ноября 2026 12:00 — проверить актуальные правила мероприятия), формат загрузки PDF-дека, ссылку на видео-демо (если требуется) и форму отправки GitHub + Live URL.
- [ ] **TBD — Финальный прогон:** прогнать выступление с таймером (`5:00` питч + `2:00` Q&A) и короткое демо (`60–90` сек) по сохранённым скриптам.
