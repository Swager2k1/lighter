# Hedge Validation, Earnings & New Listing Boosts, and Stock Prioritization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 100% надежную двустороннюю валидацию хеджируемости между API Robinhood Lighter и Arbitrum Core Lighter (полное исключение односторонних/неликвидных пар типа BE), динамический расчет бустов отчетной недели (пятница — четверг), автоматическое определение буста новых листингов текущей недели по `created_at` из API, приоритетную выдачу акций с сортировкой по `lossMarket 100%` и Open Interest, а также визуальное разграничение категорий в JSON и Telegram.

**Architecture:** 
1. `src/services/calendarService.ts`: Добавление функции `getReportingWeekInterval(now)` (пятница 00:00:00 — четверг 23:59:59). Проверка дат отчетов строго внутри текущего окна.
2. `src/services/marketMatrixService.ts`:
   - Замена статичного `CANONICAL_ASSETS` на динамическое сканирование всех доступных рынков Robinhood и Core Lighter.
   - Жесткая 9-факторная валидация хеджируемости (активный статус, отсутствие `force_reduce_only`, `is_frozen === false`, положительный OI, наличие Bid и Ask в обоих живых стаканах). Исключение любых фейковых fallback-значений потерь.
   - Определение буста новых листингов (`created_at` попадает в текущую отчетную неделю).
   - Классификация активов: Акции (`is_stock: true`) vs Другие рынки (Pre-IPO, ETF, Crypto, Commodities).
   - Ранжирование: (1) Инструменты с бустом (🔥 отчет недели или новый листинг), (2) Акции (сортировка по минимальному `loss100Pct`, затем по возрастанию Robinhood OI), (3) Остальные рынки (также по `loss100Pct` и OI).
   - Формирование JSON матрицы с явными секциями `stocks_section`, `other_markets_section` и визуальными разделителями `divider`.
   - Обновление карточек ТОП-5 в Telegram с бейджами категорий.
3. Тесты (`tests/`): модульные тесты для расчета отчетной недели, 9-факторного фильтра хеджа и сортировки.

**Tech Stack:** TypeScript, Node.js Test Runner, REST APIs Lighter (Robinhood & Arbitrum).

---

### Task 1: Алгоритм отчетной недели и бустов в calendarService

**Files:**
- Modify: `src/services/calendarService.ts`
- Modify: `tests/calendarService.test.ts`

- [ ] **Step 1: Написать failing test для расчета отчетной недели (Пятница — Четверг) и валидации буста**

В `tests/calendarService.test.ts` добавить проверки:
- Неделя для `04.11.2026` (среда): начало `30.10.2026 00:00:00`, конец `05.11.2026 23:59:59`.
- Дата отчета `06.11.2026` НЕ дает буст при текущей дате `04.11.2026`.
- Неделя для `07.11.2026` (суббота): начало `06.11.2026 00:00:00`, конец `12.11.2026 23:59:59`.
- Дата отчета `12.11.2026` ДАЕТ буст при текущей дате `07.11.2026`.

- [ ] **Step 2: Запустить тест и убедиться в ошибке**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/calendarService.test.ts`
Expected: FAIL (функция `getReportingWeekInterval` или обновленная логика `getEarningsInfo` еще не реализована).

- [ ] **Step 3: Реализовать функции в `src/services/calendarService.ts`**

Реализовать:
- `getReportingWeekInterval(currentDate: Date): { start: Date; end: Date }` (пятница — четверг).
- Обновить `getEarningsInfo(symbol: string, referenceDate?: Date)`: буст активируется только если отчет выпадает на интервал текущей недели `[start, end]` и отчет еще не прошел (`target >= today`).

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/calendarService.test.ts`
Expected: PASS.

---

### Task 2: 9-факторный валидатор хеджируемости и детектор новых листингов

**Files:**
- Modify: `src/services/marketMatrixService.ts`
- Create/Modify: `tests/marketMatrixValidation.test.ts`

- [ ] **Step 1: Написать failing test для 9-факторного валидатора**

Проверить:
- Пара с `force_reduce_only: true` (как `BE` на Arb) отбраковывается (`isHedgeable === false`).
- Пара с пустым стаканом (0 bids или 0 asks) отбраковывается.
- Пара с `created_at` на текущей неделе получает флаг `isNewListing: true` и буст.

- [ ] **Step 2: Запустить тест и убедиться в ошибке**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/marketMatrixValidation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать валидацию и определение новых листингов в `src/services/marketMatrixService.ts`**

- Реализовать функцию `validateMarketHedgeability(rhDetail, arbDetail, rhOrders, arbOrders)`.
- Реализовать функцию `checkIsNewListing(createdAtStr, weekStart)`.
- Интегрировать классификатор категорий: каталог тикеров акций (`AAPL`, `AMD`, `AMZN`, `BABA`, `COIN`, `GOOGL`, `INTC`, `META`, `MSFT`, `MU`, `NVDA`, `ORCL`, `PLTR`, `SKHY`, `SNDK`, `TSLA`, `TSM`, `BMNR` и др.) и остальных рынков.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/marketMatrixValidation.test.ts`
Expected: PASS.

---

### Task 3: Приоритет акций, сортировка по lossMarket 100% и визуальное оформление

**Files:**
- Modify: `src/services/marketMatrixService.ts`
- Modify: `tests/marketMatrixService.test.ts`

- [ ] **Step 1: Написать failing test для структуры JSON и логики сортировки**

В `tests/marketMatrixService.test.ts`:
- Проверить, что бустовые пары идут вверху.
- Проверить, что все акции идут перед остальными парами.
- Проверить, что внутри акций сортировка идет по `loss100Pct` (наименьший lossMarket 100%), затем по `oiRobinhoodUsd`.
- Проверить, что `generateCanonicalJsonFile` содержит секции `stocks_section`, `other_markets_section` и разделители `divider`.

- [ ] **Step 2: Запустить тест и убедиться в ошибке**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/marketMatrixService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать алгоритм сортировки и генерацию структурированного JSON и Telegram карточек**

В `src/services/marketMatrixService.ts`:
- Обновить `scanCanonicalMarketMatrix`:
  - Динамический сбор всех 50 живых хеджируемых пар.
  - Применение сортировки: (1) `hasBoost` (отчет недели или новый листинг), (2) Акции (по `loss100Pct`, затем OI), (3) Остальные рынки.
  - Топ-5 карточек: заполнение акциями/бустами в первую очередь; если не хватает, остальными.
  - Карточки с бейджами: `[АКЦИЯ 📈]` / `[КРИПТО/ДРУГОЕ 🌐]`.
  - JSON матрица: разделение на секции с разделителями `══════════ СЕКЦИЯ АКЦИЙ ══════════` и `══════════ ДРУГИЕ РЫНКИ ══════════`.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test ./tests/marketMatrixService.test.ts`
Expected: PASS.

---

### Task 4: Финальная сквозная проверка (Type Check и интеграционный прогон)

**Files:**
- All modified files

- [ ] **Step 1: Запустить компилятор TypeScript**

Run: `& "C:\Program Files\nodejs\node.exe" --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit`
Expected: Exit code 0, 0 ошибок типов.

- [ ] **Step 2: Запустить все юнит-тесты проекта**

Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test tests/*.test.ts`
Expected: Все тесты проходят успешно.

- [ ] **Step 3: Провести тестовый запуск сканера живых стаканов**

Run: `& "C:\Program Files\nodejs\node.exe" -e "import('./src/services/marketMatrixService.js').then(m => m.scanCanonicalMarketMatrix('open')).then(r => { console.log('Top Cards Preview:'); console.log(r.topCardsText.slice(0, 500)); const j = JSON.parse(r.fileContent); console.log('Total markets:', j.total_markets, 'Stocks:', j.total_stocks, 'Others:', j.total_other_markets); console.log('Is BE included?', j.markets ? j.markets.some(m => m.symbol === 'BE') : false); }).catch(console.error);"`
Expected: `Is BE included? false`, отображаются все реальные пары, акции в приоритете, бусты отмечены.

