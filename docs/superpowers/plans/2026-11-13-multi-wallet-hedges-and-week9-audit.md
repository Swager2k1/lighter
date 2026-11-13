# Реализация одновременного мульти-кошелька для Lighter Bot и Ончейн-Аудит Week 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 
1. Исправить торговый журнал `pnl_and_points_analysis.csv` на основе фактических ончейн-данных Week 9 (Lighter REST API).
2. Сформировать официальный рекап `week9_recap.md` с точной математикой поинтов и себестоимости.
3. Полностью устранить архитектурный баг бота, мешающий открывать и закрывать позиции по одному активу на двух кошельках одновременно.

**Architecture:**
В текущей архитектуре связка идентифицируется исключительно строкой `symbol` (например `"SKHY"`). Это приводит к тому, что при открытии связки на W2 затирается связка W1 в `config.json` и `currentHedge`, деактивация `/c` закрывает случайную ногу, а в CSV пишется некорректный PnL.
Решение:
- Ввести составной ключ связки: `id = `${symbol}_${walletSlot}`` (например `SKHY_w1` и `SKHY_w2`).
- В типе `ThreeLegHedge` добавить поле `walletSlot: 'w1' | 'w2'` и уникальный `id`.
- Обновить функции в `src/config.ts`: `saveHedgeConfig`, `deactivateHedge`, `getActiveHedges` для работы с составным ключом и кошельком.
- В `src/services/positionSyncService.ts`: обновить `activateHedgeOnchain` и `deactivateHedgeOnchain`, добавив явный параметр кошелька `targetWallet?: 'w1' | 'w2'`, и парсинг кошелька в `parseCloseCommandArgs`.
- В `src/bot/telegram.ts`: расширить поддержку команд `/o <sym> [w1|w2]`, `/c <sym> [w1|w2] [price]`, а также инлайн-кнопок закрытия (`close_SKHY_w1`, `close_SKHY_w2`).

**Tech Stack:** TypeScript, Node.js, Lighter REST API, Viem/BigInt utils.

---

### Task 1: Ончейн-верификация и исправление `pnl_and_points_analysis.csv` для Week 9

**Files:**
- Modify: `pnl_and_points_analysis.csv:119-134`

- [ ] **Step 1: Проверить фактические ончейн-балансы и рассчитать точный PnL всех позиций Week 9**
  - W1 Live Equity: $13,987.10 (RH $6,783.42 + Arb $7,203.68)
  - W2 Live Equity: $4,800.70 (RH $2,399.54 + Arb $2,401.16)
  - Стартовые балансы: W1 $13,615.51, W2 $4,842.33
  - Позиции W1:
    - SKHY #1: -$11.16 (закрыта)
    - XRP: +$34.73 (закрыта)
    - SKHY #2: -$62.29 (закрыта)
    - SKHY #3: +$7.31 (закрыта)
    - SNDK: +$4.60 (закрыта)
    - SKHY #4: внести корректное закрытие по ончейн-выходу 13.11 (~$135.34, net PnL +$31.54)
  - Позиции W2:
    - ORCL: исправить маржу с ошибочных $22.37 на фактические $2,422.37 (Leverage 6.91x), PnL +$2.91
    - SKHY W2 #1: зафиксировать закрытие перед перезаходом (PnL -$9.63)
    - SKHY W2 #2: закрытие 13.11 (PnL -$9.64)
  - Добавить итоговые строки Week 9:
    - Week 9 W1 Closed Total: поинтов 116.66 pts, затраты ~$0.00 (чистый профит +$4.73)
    - Week 9 W2 Closed Total: поинтов 25.85 pts, затраты -$16.36
    - Week 9 Portfolio Final: поинтов 142.51 pts, затраты -$11.63 (чистый профит или -$0.08/pt)
    - Обновить строку 2: EXECUTIVE ALL-TIME KPI

- [ ] **Step 2: Внести исправления в `pnl_and_points_analysis.csv`**
  - Обновить строки 119-134, добавить закрытие SKHY W1 и итоговые строки недели.

---

### Task 2: Создание официального рекапа `week9_recap.md`

**Files:**
- Create: `week9_recap.md`

- [ ] **Step 1: Создать `week9_recap.md` по строгому каноническому стандарту `week8_recap.md`**
  - Раздел 1: Расчёт поинтов за неделю (дельта ровно за 7 дней: W1 +116.66 pts, W2 +25.85 pts, Итого +142.51 pts).
  - Раздел 2: Затраты, себестоимость поинта ($0.08/pt – $0.24/pt) и отдача на $1,000 капитала.
  - Раздел 3: Анализ множителя от Live (3.2x – 3.8x).
  - Раздел 4: Детективный разбор стратегий W1 (SKHY/SNDK/XRP) и W2 (ORCL/SKHY).
  - Раздел 5: Разбор и устранение бага одновременного удержания позиций.
  - Раздел 6: Рекомендации на Week 10.
  - Раздел 7: Обновление All-Time баз данных (включая `weekly_reports.json`).

- [ ] **Step 2: Обновить `weekly_reports.json`**
  - Добавить записи Week 9 W1, Week 9 W2 и Week 9 Portfolio Total.

---

### Task 3: Архитектурный фикс: поддержка независимых связок по кошелькам в типах и `src/config.ts`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Обновить `src/types.ts`**
  - Добавить в `ThreeLegHedge` поля:
    ```typescript
    id?: string; // уникальный ключ связки, например "SKHY_w1" или "SKHY_w2"
    walletSlot?: 'w1' | 'w2';
    ```

- [ ] **Step 2: Обновить `saveHedgeConfig`, `deactivateHedge`, `getActiveHedges` в `src/config.ts`**
  - Функция генерации ID связки: `getHedgeId(symbol: string, walletSlot?: 'w1' | 'w2', walletAddress?: string): string`.
  - В `saveHedgeConfig`: находить связку по составному `id` (или `symbol + walletSlot` / `walletAddress`), а не просто по `symbol`! Это гарантирует, что W2 не перезапишет W1.
  - В `deactivateHedge(symbol: string, walletSlot?: 'w1' | 'w2')`: деактивировать только связку с указанным кошельком, если он задан, либо все связки этого символа, если кошелек не передан.

---

### Task 4: Обновление сервиса синхронизации позиций `src/services/positionSyncService.ts`

**Files:**
- Modify: `src/services/positionSyncService.ts`

- [ ] **Step 1: Обновить `parseCloseCommandArgs`**
  - Поддержать синтаксис `/c SYMBOL [w1|w2] [exitPrice]` и `/c SYMBOL [exitPrice] [w1|w2]`.
  - Возвращать `{ symbol, targetWallet?: 'w1' | 'w2', exitPrice?: number }`.

- [ ] **Step 2: Обновить `activateHedgeOnchain`**
  - При создании `updatedHedge` присваивать `id = `${normSym}_${selectedWallet}`` и `walletSlot = selectedWallet`.
  - Сохранять обе связки независимо.

- [ ] **Step 3: Обновить `deactivateHedgeOnchain`**
  - Принимать `targetWallet?: 'w1' | 'w2'` и `manualExitPrice?: number`.
  - Находить конкретный хедж: сначала по `symbol + walletSlot === targetWallet`, затем fallback.
  - В CSV exit row в колонку Venue подставлять конкретный кошелек (`targetName` = "Wallet 1 (W1)" или "Wallet 2 (W2)"), а не обезличенное "Robinhood + Arbitrum".

---

### Task 5: Обновление Telegram бота и обработчиков команд

**Files:**
- Modify: `src/bot/handlers.ts`
- Modify: `src/bot/telegram.ts`
- Modify: `src/services/marketMatrixService.ts`

- [ ] **Step 1: Обновить `calculateActiveHedgesExitReport` в `src/services/marketMatrixService.ts`**
  - Для инлайн-кнопок закрытия формировать `callback_data: `close_${h.symbol}_${h.walletSlot || 'w1'}`` и текст `🛑 Закрыть ${h.symbol} (${h.walletSlot?.toUpperCase() || 'W1'})`.

- [ ] **Step 2: Обновить `handleCallbackQuery` и обработку `/c` в `src/bot/telegram.ts`**
  - Парсить `callback_data` вида `close_SKHY_w1` или `close_SKHY`.
  - В обработке `/c`: передавать `parsed.targetWallet` в `deactivateHedgeOnchain`.

---

### Task 6: Автоматическая проверка типов (Proof of Work) и тестирование

**Files:**
- Terminal Verification

- [ ] **Step 1: Запустить `tsc --noEmit`**
  - Команда: `& "C:\Program Files\nodejs\node.exe" --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit`
  - Устранить любые ошибки типизации.

- [ ] **Step 2: Запустить unit-тесты бота**
  - Проверить парсинг команд `/o` и `/c`, разделение связок W1/W2.

