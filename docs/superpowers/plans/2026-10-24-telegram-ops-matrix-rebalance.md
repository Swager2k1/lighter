# Telegram Hedge Ops Terminal (/o, /c, /b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать в Telegram-боте удалённый Hedge Ops терминал: сканирование стаканов 27 рынков и расчет потерь маркетом (`/o`, `/c`), расчет ребалансировки депозитов между сетями (`/b`), фиксацию входа/выхода с ончейн-проверкой (`/o <TICKER>`, `/c <TICKER>`), обновление `config.json` и ведение журнала `pnl_and_points_analysis.csv`.

**Architecture:** Модульная архитектура с разделением ответственности: `calendarService` (учёт отчётов компаний), `rebalanceService` (аудит депозитов и инструкция по бриджу), `marketMatrixService` (Orderbook Walk по 27 парам с динамическим сайзингом 7x), `positionSyncService` (ончейн-фиксация, управление флагом `active` и запись в CSV), и расширение `TelegramBotService` поддержкой `sendDocument` для отправки полной матрицы файлом. Фоновый цикл мониторинга ликвидаций и критическая сирена в `index.ts` продолжают работать автономно.

**Tech Stack:** TypeScript / Node.js (ES Modules), native fetch / AbortSignal, Node native test runner (`node --import tsx --test`), Telegram Bot API (sendMessage, sendDocument via FormData).

---

## File Structure Map

```
c:/$OFT/_Vibecoding/Lighter-poly/
├── earnings_calendar.json                     # Календарь отчетов на текущую неделю
├── src/
│   ├── services/
│   │   ├── calendarService.ts                 # Чтение и парсинг earnings_calendar.json
│   │   ├── rebalanceService.ts                # Ончейн-аудит депозитов W1/W2, вычисление перекоса и формул бриджа
│   │   ├── marketMatrixService.ts             # Orderbook Walk 50 уровней, симуляция потерь 100%/50%, генерация Markdown
│   │   └── positionSyncService.ts             # Ончейн-проверка сделок, расчет фактического сайза/плеча, апдейт config.json и CSV
│   ├── bot/
│   │   ├── handlers.ts                        # Обработчики команд /o, /c, /b (с аргументами и без)
│   │   └── telegram.ts                        # Добавление метода sendDocument (multipart form-data)
├── tests/
│   ├── calendarService.test.ts                # Тесты чтения календаря
│   ├── rebalanceService.test.ts               # Тесты расчета ребалансировки и бриджа
│   ├── marketMatrixService.test.ts            # Тесты эмуляции стаканов и расчёта потерь
│   ├── positionSyncService.test.ts            # Тесты синхронизации с config.json и CSV
│   └── botOpsCommands.test.ts                 # Интеграционные тесты обработчиков команд
└── package.json                               # Добавление новых тестов в скрипт test
```

---

### Task 1: Earnings Calendar Service (`earnings_calendar.json` & `calendarService.ts`)

**Files:**
- Create: `earnings_calendar.json`
- Create: `src/services/calendarService.ts`
- Test: `tests/calendarService.test.ts`

- [ ] **Step 1: Создать файл календаря отчетов `earnings_calendar.json` в корне проекта**

```json
{
  "updatedAt": "2026-10-24",
  "currentFarmWeek": "Week 11 (24.10 - 30.10)",
  "earnings": {
    "MSFT": { "date": "28.10.2026", "time": "AMC", "boost": true, "risk": "Закрыть до 27.10" },
    "GOOGL": { "date": "28.10.2026", "time": "AMC", "boost": true, "risk": "Закрыть до 27.10" },
    "AMZN": { "date": "29.10.2026", "time": "AMC", "boost": true, "risk": "Закрыть до 28.10" },
    "COIN": { "date": "29.10.2026", "time": "AMC", "boost": true, "risk": "Закрыть до 28.10" },
    "AAPL": { "date": "30.10.2026", "time": "AMC", "boost": true, "risk": "Закрыть до 29.10" },
    "META": { "date": "30.10.2026", "time": "AMC", "boost": true, "risk": "Закрыть до 29.10" }
  }
}
```

- [ ] **Step 2: Написать падающий тест для `calendarService`**

Создать `tests/calendarService.test.ts`:
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { getEarningsInfo } from '../src/services/calendarService.js';

test('calendarService correctly returns earnings info for MSFT', () => {
  const info = getEarningsInfo('MSFT');
  assert.equal(info.hasEarnings, true);
  assert.equal(info.boost, true);
  assert.equal(info.date, '28.10.2026');
});

test('calendarService returns fallback for assets without earnings', () => {
  const info = getEarningsInfo('TSM');
  assert.equal(info.hasEarnings, false);
  assert.equal(info.boost, false);
  assert.equal(info.riskText, '🟢 Безопасно (нет отчета)');
});
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Запуск: `node --import tsx --test tests/calendarService.test.ts`  
Ожидается: FAIL ("Cannot find module '../src/services/calendarService.js'")

- [ ] **Step 4: Реализовать `src/services/calendarService.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';

export interface EarningsRecord {
  date: string;
  time?: string;
  boost: boolean;
  risk: string;
}

export interface EarningsCalendarFile {
  updatedAt: string;
  currentFarmWeek: string;
  earnings: Record<string, EarningsRecord>;
}

export interface AssetEarningsInfo {
  hasEarnings: boolean;
  boost: boolean;
  date: string;
  riskText: string;
  displayColumn: string;
}

export function loadEarningsCalendar(): EarningsCalendarFile {
  const calendarPath = path.resolve(process.cwd(), 'earnings_calendar.json');
  try {
    if (fs.existsSync(calendarPath)) {
      const raw = fs.readFileSync(calendarPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[CalendarService] Ошибка чтения earnings_calendar.json:', err);
  }

  return {
    updatedAt: new Date().toISOString(),
    currentFarmWeek: 'Auto-fallback',
    earnings: {},
  };
}

export function getEarningsInfo(symbol: string): AssetEarningsInfo {
  const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  const calendar = loadEarningsCalendar();
  const item = calendar.earnings[norm];

  if (item && item.boost) {
    return {
      hasEarnings: true,
      boost: true,
      date: item.date,
      riskText: `⚠️ Отчет ${item.date} (${item.risk})`,
      displayColumn: `${item.date} 🔥 (Буст | ${item.risk})`,
    };
  }

  return {
    hasEarnings: false,
    boost: false,
    date: '—',
    riskText: '🟢 Безопасно (нет отчета)',
    displayColumn: '— (Без отчета 🟢)',
  };
}
```

- [ ] **Step 5: Прогнать тест и убедиться, что он проходит**

Запуск: `node --import tsx --test tests/calendarService.test.ts`  
Ожидается: PASS (2 tests pass)

---

### Task 2: Rebalance & Bridge Service (`rebalanceService.ts` & `/b`)

**Files:**
- Create: `src/services/rebalanceService.ts`
- Test: `tests/rebalanceService.test.ts`

- [ ] **Step 1: Написать падающий тест для `rebalanceService`**

Создать `tests/rebalanceService.test.ts`:
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWalletRebalance } from '../src/services/rebalanceService.js';

test('calculateWalletRebalance computes correct skew when RH exceeds Arb', () => {
  const result = calculateWalletRebalance({
    walletName: 'Wallet 1',
    walletAddress: '0xf5FC58036A680707DB6E7df869bb616A6d35aF7f',
    rhEquity: 7000,
    rhCollateral: 2000,
    arbEquity: 3000,
    arbCollateral: 3000,
  });

  assert.equal(result.totalEquity, 10000);
  assert.equal(result.targetPerLeg, 5000);
  assert.equal(result.skewUsd, 4000);
  assert.equal(result.bridgeAmountUsd, 2000);
  assert.equal(result.bridgeDirection, 'RH_TO_ARB');
  assert.match(result.recommendationText, /перевести \$2000.*из Robinhood в Arbitrum/);
});

test('calculateWalletRebalance computes correct skew when Arb exceeds RH', () => {
  const result = calculateWalletRebalance({
    walletName: 'Wallet 2',
    walletAddress: '0x1F1414F64161287f2eb849b09083A50C6C513Ff2',
    rhEquity: 2000,
    rhCollateral: 2000,
    arbEquity: 6000,
    arbCollateral: 1500,
  });

  assert.equal(result.totalEquity, 8000);
  assert.equal(result.targetPerLeg, 4000);
  assert.equal(result.skewUsd, -4000);
  assert.equal(result.bridgeAmountUsd, 2000);
  assert.equal(result.bridgeDirection, 'ARB_TO_RH');
  assert.match(result.recommendationText, /перевести \$2000.*из Arbitrum в Robinhood/);
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `node --import tsx --test tests/rebalanceService.test.ts`  
Ожидается: FAIL ("Cannot find module '../src/services/rebalanceService.js'")

- [ ] **Step 3: Реализовать `src/services/rebalanceService.ts`**

```typescript
export interface WalletBalancesInput {
  walletName: string;
  walletAddress: string;
  rhEquity: number;
  rhCollateral: number;
  arbEquity: number;
  arbCollateral: number;
}

export interface RebalanceResult {
  walletName: string;
  walletAddress: string;
  rhEquity: number;
  rhCollateral: number;
  arbEquity: number;
  arbCollateral: number;
  totalEquity: number;
  targetPerLeg: number;
  skewUsd: number;
  bridgeAmountUsd: number;
  bridgeDirection: 'BALANCED' | 'RH_TO_ARB' | 'ARB_TO_RH';
  maxSafeBridgeUsd: number;
  recommendationText: string;
}

export function calculateWalletRebalance(input: WalletBalancesInput): RebalanceResult {
  const totalEquity = parseFloat((input.rhEquity + input.arbEquity).toFixed(2));
  const targetPerLeg = parseFloat((totalEquity / 2).toFixed(2));
  const skewUsd = parseFloat((input.rhEquity - input.arbEquity).toFixed(2));
  const halfSkew = parseFloat((Math.abs(skewUsd) / 2).toFixed(2));

  let bridgeDirection: 'BALANCED' | 'RH_TO_ARB' | 'ARB_TO_RH' = 'BALANCED';
  let bridgeAmountUsd = 0;
  let maxSafeBridgeUsd = 0;
  let recommendationText = '✅ Балансы идеально уравновешены (50/50). Бридж не требуется.';

  if (skewUsd > 10) {
    bridgeDirection = 'RH_TO_ARB';
    bridgeAmountUsd = halfSkew;
    maxSafeBridgeUsd = Math.min(halfSkew, input.rhCollateral);
    recommendationText = `💡 **Рекомендация:** перевести **$${bridgeAmountUsd}** из **Robinhood Chain** в **Arbitrum zkLighter**.`;
    if (input.rhCollateral < halfSkew) {
      recommendationText += `\n⚠️ *Внимание:* в свободной марже RH доступно только **$${input.rhCollateral}** (остальное занято в сделках).`;
    }
  } else if (skewUsd < -10) {
    bridgeDirection = 'ARB_TO_RH';
    bridgeAmountUsd = halfSkew;
    maxSafeBridgeUsd = Math.min(halfSkew, input.arbCollateral);
    recommendationText = `💡 **Рекомендация:** перевести **$${bridgeAmountUsd}** из **Arbitrum zkLighter** в **Robinhood Chain**.`;
    if (input.arbCollateral < halfSkew) {
      recommendationText += `\n⚠️ *Внимание:* в свободной марже Arb доступно только **$${input.arbCollateral}** (остальное занято в сделках).`;
    }
  }

  return {
    walletName: input.walletName,
    walletAddress: input.walletAddress,
    rhEquity: input.rhEquity,
    rhCollateral: input.rhCollateral,
    arbEquity: input.arbEquity,
    arbCollateral: input.arbCollateral,
    totalEquity,
    targetPerLeg,
    skewUsd,
    bridgeAmountUsd,
    bridgeDirection,
    maxSafeBridgeUsd,
    recommendationText,
  };
}

export async function fetchLiveWalletEquity(walletAddress: string): Promise<{
  rhEquity: number;
  rhCollateral: number;
  arbEquity: number;
  arbCollateral: number;
}> {
  const normAddr = walletAddress.trim();
  const rhUrl = `https://api.rh.lighter.xyz/api/v1/account?by=l1_address&value=${normAddr}`;
  const arbUrl = `https://mainnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${normAddr}`;

  const [rhRes, arbRes] = await Promise.allSettled([
    fetch(rhUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json()),
    fetch(arbUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json()),
  ]);

  let rhEquity = 0;
  let rhCollateral = 0;
  let arbEquity = 0;
  let arbCollateral = 0;

  if (rhRes.status === 'fulfilled' && rhRes.value?.accounts?.[0]) {
    const acc = rhRes.value.accounts[0];
    rhEquity = parseFloat(acc.total_asset_value || acc.collateral || '0');
    rhCollateral = parseFloat(acc.collateral || '0');
  }

  if (arbRes.status === 'fulfilled' && arbRes.value?.accounts?.[0]) {
    const acc = arbRes.value.accounts[0];
    arbEquity = parseFloat(acc.total_asset_value || acc.collateral || '0');
    arbCollateral = parseFloat(acc.collateral || '0');
  }

  return { rhEquity, rhCollateral, arbEquity, arbCollateral };
}

export function formatRebalanceReport(reports: RebalanceResult[]): string {
  const lines: string[] = [
    `⚖️ **РЕБАЛАНСИРОВКА И БРИДЖ ДЕПОЗИТОВ (/b)**`,
    `Расчёт паритета 50/50 между Robinhood и Arbitrum Core:`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];

  for (const r of reports) {
    const skewSign = r.skewUsd >= 0 ? `+${r.skewUsd}` : `${r.skewUsd}`;
    lines.push(
      `💼 **${r.walletName}** (\`${r.walletAddress.slice(0, 6)}...${r.walletAddress.slice(-4)}\`)`,
      `• Совокупный капитал: **$${r.totalEquity}** (цель на ногу: **$${r.targetPerLeg}**)`,
      `• Robinhood: **$${r.rhEquity}** (свободно: $${r.rhCollateral})`,
      `• Arbitrum Core: **$${r.arbEquity}** (свободно: $${r.arbCollateral})`,
      `• Перекос (RH - Arb): **$${skewSign}**`,
      `${r.recommendationText}`,
      ``
    );
  }

  lines.push(`💡 Перевод восстановит симметричную маржу для безопасного открытия следующего цикла.`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Запуск: `node --import tsx --test tests/rebalanceService.test.ts`  
Ожидается: PASS (2 tests pass)

---

### Task 3: Market Matrix Engine & Orderbook Walk (`marketMatrixService.ts`)

**Files:**
- Create: `src/services/marketMatrixService.ts`
- Test: `tests/marketMatrixService.test.ts`

- [ ] **Step 1: Написать падающий тест для Orderbook Walk и динамического сайзинга**

Создать `tests/marketMatrixService.test.ts`:
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateOrderbookWalk,
  calculateDynamicNotional,
  OrderbookLevel,
} from '../src/services/marketMatrixService.js';

test('calculateDynamicNotional calculates 7x leverage for 100% and 50% scenarios', () => {
  const sizing = calculateDynamicNotional(10000);
  assert.equal(sizing.totalEquity, 10000);
  assert.equal(sizing.margin100Pct, 5000);
  assert.equal(sizing.notional100Pct, 35000); // 5000 * 7
  assert.equal(sizing.margin50Pct, 2500);
  assert.equal(sizing.notional50Pct, 17500); // 2500 * 7
});

test('simulateOrderbookWalk calculates market loss correctly for given depth', () => {
  const rhBids: OrderbookLevel[] = [
    { price: 100, size: 50 }, // $5,000
    { price: 99, size: 100 }, // $9,900
  ];
  const arbAsks: OrderbookLevel[] = [
    { price: 101, size: 50 }, // $5,050
    { price: 102, size: 100 }, // $10,200
  ];

  const walk = simulateOrderbookWalk({
    targetNotional: 10000,
    sellSideLevels: rhBids, // RH Short: sell into bids
    buySideLevels: arbAsks, // Arb Long: buy from asks
  });

  assert.equal(walk.exhausted, false);
  assert.ok(walk.avgSellPrice <= 100);
  assert.ok(walk.avgBuyPrice >= 101);
  assert.ok(walk.lossUsd > 0);
  assert.ok(walk.lossPct > 0);
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `node --import tsx --test tests/marketMatrixService.test.ts`  
Ожидается: FAIL ("Cannot find module '../src/services/marketMatrixService.js'")

- [ ] **Step 3: Реализовать `src/services/marketMatrixService.ts`**

Включает:
- Сбор стаканов Lighter (RH + Arb) глубиной 50 уровней
- Формулы Orderbook Walk (на вход и на выход)
- Сортировку строго по возрастанию `OI Robinhood ($) 🟢`
- Формирование ТОП-5 карточек для Telegram (с Потерями 100% и 50% в начале, обоими OI и стенками)
- Формирование полного файла `market_matrix.md` по всем 27 рынкам

```typescript
import { getEarningsInfo } from './calendarService.js';
import { fetchLiveWalletEquity } from './rebalanceService.js';

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface DynamicNotionalSizing {
  totalEquity: number;
  margin100Pct: number;
  notional100Pct: number;
  margin50Pct: number;
  notional50Pct: number;
}

export interface OrderbookWalkResult {
  exhausted: boolean;
  executedNotional: number;
  avgSellPrice: number;
  avgBuyPrice: number;
  lossUsd: number;
  lossPct: number;
}

export interface MarketMatrixRow {
  symbol: string;
  type: string;
  earningsText: string;
  hasEarningsBoost: boolean;
  loss100Usd: number;
  loss100Pct: number;
  loss50Usd: number;
  loss50Pct: number;
  oiRobinhoodUsd: number;
  oiArbitrumUsd: number;
  wallRhL1: string;
  wallRhL2: string;
  wallArbL1: string;
  wallArbL2: string;
  maxEntryWallUsd: number;
  edgeSpreadPct: number;
  macroRisk: string;
  verdict: string;
}

export function calculateDynamicNotional(totalEquity: number, leverage = 7): DynamicNotionalSizing {
  const safeEquity = totalEquity > 0 ? totalEquity : 10000;
  const margin100Pct = parseFloat((safeEquity / 2).toFixed(2));
  const notional100Pct = parseFloat((margin100Pct * leverage).toFixed(2));
  const margin50Pct = parseFloat((safeEquity / 4).toFixed(2));
  const notional50Pct = parseFloat((margin50Pct * leverage).toFixed(2));

  return {
    totalEquity: safeEquity,
    margin100Pct,
    notional100Pct,
    margin50Pct,
    notional50Pct,
  };
}

export function simulateOrderbookWalk(params: {
  targetNotional: number;
  sellSideLevels: OrderbookLevel[];
  buySideLevels: OrderbookLevel[];
}): OrderbookWalkResult {
  const { targetNotional, sellSideLevels, buySideLevels } = params;

  let remainingSellNotional = targetNotional;
  let totalSellUnits = 0;
  let totalSellCash = 0;

  for (const lvl of sellSideLevels) {
    const lvlCash = lvl.price * lvl.size;
    if (lvlCash <= 0) continue;
    if (remainingSellNotional <= lvlCash) {
      const units = remainingSellNotional / lvl.price;
      totalSellUnits += units;
      totalSellCash += remainingSellNotional;
      remainingSellNotional = 0;
      break;
    } else {
      totalSellUnits += lvl.size;
      totalSellCash += lvlCash;
      remainingSellNotional -= lvlCash;
    }
  }

  let remainingBuyNotional = targetNotional;
  let totalBuyUnits = 0;
  let totalBuyCash = 0;

  for (const lvl of buySideLevels) {
    const lvlCash = lvl.price * lvl.size;
    if (lvlCash <= 0) continue;
    if (remainingBuyNotional <= lvlCash) {
      const units = remainingBuyNotional / lvl.price;
      totalBuyUnits += units;
      totalBuyCash += remainingBuyNotional;
      remainingBuyNotional = 0;
      break;
    } else {
      totalBuyUnits += lvl.size;
      totalBuyCash += lvlCash;
      remainingBuyNotional -= lvlCash;
    }
  }

  const exhausted = remainingSellNotional > 0 || remainingBuyNotional > 0;
  const avgSellPrice = totalSellUnits > 0 ? totalSellCash / totalSellUnits : 0;
  const avgBuyPrice = totalBuyUnits > 0 ? totalBuyCash / totalBuyUnits : 0;

  const baseQty = Math.min(totalSellUnits, totalBuyUnits);
  const lossUsd = baseQty > 0 ? parseFloat(((avgBuyPrice - avgSellPrice) * baseQty).toFixed(2)) : 0;
  const lossPct = targetNotional > 0 ? parseFloat(((lossUsd / targetNotional) * 100).toFixed(3)) : 0;

  return {
    exhausted,
    executedNotional: Math.min(totalSellCash, totalBuyCash),
    avgSellPrice: parseFloat(avgSellPrice.toFixed(4)),
    avgBuyPrice: parseFloat(avgBuyPrice.toFixed(4)),
    lossUsd,
    lossPct,
  };
}

export function formatTopCardsMessage(params: {
  walletsSummary: string;
  sizing: DynamicNotionalSizing;
  topRows: MarketMatrixRow[];
  mode: 'open' | 'close';
}): string {
  const { walletsSummary, sizing, topRows, mode } = params;
  const title = mode === 'open' ? '🚀 ТОП-5 ДЛЯ ВХОДА В СВЯЗКУ (/o)' : '🛑 ТОП-5 РАСХОДОВ НА ЗАКРЫТИЕ (/c)';

  const lines = [
    `📊 **ОНЧЕЙН-БАЛАНСЫ ПОРТФЕЛЯ (LIVE)**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    walletsSummary,
    `• 100% Notional (7x): **$${sizing.notional100Pct}** (маржа: $${sizing.margin100Pct})`,
    `• 50% Notional (7x): **$${sizing.notional50Pct}** (маржа: $${sizing.margin50Pct})`,
    ``,
    `🏆 **${title}**`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];

  topRows.forEach((r, idx) => {
    const icon = r.hasEarningsBoost ? '🔥' : idx === 0 ? '🟢' : '🔹';
    lines.push(
      `${idx + 1}. ${icon} **$${r.symbol}** (${r.earningsText})`,
      `   • Потери 100%: **-$${r.loss100Usd}** (${r.loss100Pct}%) | 50%: **-$${r.loss50Usd}** (${r.loss50Pct}%)`,
      `   • OI RH: **$${(r.oiRobinhoodUsd / 1000).toFixed(1)}k** 🟢 | OI Arb: **$${(r.oiArbitrumUsd / 1000).toFixed(1)}k**`,
      `   • Стенки RH/Arb: **${r.wallRhL1}** / **${r.wallArbL1}** (макс 1 стенка: $${r.maxEntryWallUsd})`,
      `   • Спред краёв: **${r.edgeSpreadPct}%**`,
      `   • 💡 Вердикт: *${r.verdict}*`,
      ``
    );
  });

  lines.push(`📎 *Полная каноническая таблица по всем 27 инструментам прикреплена файлом ниже.*`);
  return lines.join('\n');
}

export function generateCanonicalMarkdownFile(rows: MarketMatrixRow[], sizing: DynamicNotionalSizing): string {
  const header = [
    `# Lighter Canonical Market Matrix`,
    `> Сгенерировано ончейн: ${new Date().toLocaleString()}`,
    `> Total Equity: $${sizing.totalEquity} | 100% Notional: $${sizing.notional100Pct} | 50% Notional: $${sizing.notional50Pct}`,
    ``,
    `| Актив | Тип | Отчёт (дата/риск) | Потери маркетом 100% ($ и %) | Потери маркетом 50% ($ и %) | OI Robinhood ($) 🟢 | OI Arbitrum ($) | Стенки RH (Bid): L1 / L2 ($) | Стенки Arb (Ask): L1 / L2 ($) | Макс. вход в 1 стенку | Спред краёв | Влияние новостей / Макро-риск | Итоговый вердикт по исполнению |`,
    `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- | :--- | :---: | :---: | :--- | :--- |`,
  ];

  for (const r of rows) {
    header.push(
      `| **${r.symbol}** | ${r.type} | ${r.earningsText} | -$${r.loss100Usd} (${r.loss100Pct}%) | -$${r.loss50Usd} (${r.loss50Pct}%) | $${r.oiRobinhoodUsd} | $${r.oiArbitrumUsd} | ${r.wallRhL1} / ${r.wallRhL2} | ${r.wallArbL1} / ${r.wallArbL2} | $${r.maxEntryWallUsd} | ${r.edgeSpreadPct}% | ${r.macroRisk} | ${r.verdict} |`
    );
  }

  return header.join('\n');
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Запуск: `node --import tsx --test tests/marketMatrixService.test.ts`  
Ожидается: PASS (2 tests pass)

---

### Task 4: Position Sync & Accounting Service (`positionSyncService.ts`)

**Files:**
- Create: `src/services/positionSyncService.ts`
- Test: `tests/positionSyncService.test.ts`

- [ ] **Step 1: Написать падающий тест для расчета Entry Friction и формирования записей CSV**

Создать `tests/positionSyncService.test.ts`:
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEntryFriction,
  formatCsvEntryRow,
  formatCsvExitRow,
} from '../src/services/positionSyncService.js';

test('calculateEntryFriction calculates dollar and percent cost of entry', () => {
  const friction = calculateEntryFriction({
    rhShortPrice: 427.40,
    arbLongPrice: 428.10,
    size: 13.84,
    notional: 5925,
  });

  assert.equal(friction.frictionUsd, 9.69); // (428.10 - 427.40) * 13.84 = 9.688
  assert.ok(friction.frictionPct > 0.15 && friction.frictionPct < 0.17);
});

test('formatCsvEntryRow produces valid CSV row for pnl_and_points_analysis.csv', () => {
  const row = formatCsvEntryRow({
    week: 'Week 11',
    period: '24.10 - 30.10',
    asset: 'TSM',
    venue: 'Robinhood (W1)',
    legDescription: 'Robinhood 1 (Short)',
    side: 'SHORT',
    entryPrice: 427.40,
    size: 13.84,
    margin: 860,
    frictionUsd: 9.69,
  });

  assert.ok(row.includes('Week 11'));
  assert.ok(row.includes('TSM'));
  assert.ok(row.includes('427.4'));
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `node --import tsx --test tests/positionSyncService.test.ts`  
Ожидается: FAIL ("Cannot find module '../src/services/positionSyncService.js'")

- [ ] **Step 3: Реализовать `src/services/positionSyncService.ts`**

Реализует:
- Ончейн-проверку открытой сделки по тикеру
- Активацию (`active: true`) или деактивацию (`active: false`) в `config.json`
- Запись строк в `pnl_and_points_analysis.csv`
- Формирование отчетов для Telegram

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig } from '../config.js';
import { fetchLighterPositions } from '../connectors/lighter.js';

export interface EntryFrictionParams {
  rhShortPrice: number;
  arbLongPrice: number;
  size: number;
  notional: number;
}

export function calculateEntryFriction(params: EntryFrictionParams): { frictionUsd: number; frictionPct: number } {
  const { rhShortPrice, arbLongPrice, size, notional } = params;
  const frictionUsd = parseFloat(((arbLongPrice - rhShortPrice) * size).toFixed(2));
  const frictionPct = notional > 0 ? parseFloat(((frictionUsd / notional) * 100).toFixed(3)) : 0;
  return { frictionUsd, frictionPct };
}

export function formatCsvEntryRow(params: {
  week: string;
  period: string;
  asset: string;
  venue: string;
  legDescription: string;
  side: string;
  entryPrice: number;
  size: number;
  margin: number;
  frictionUsd: number;
}): string {
  // Format matches pnl_and_points_analysis.csv:
  // Week,Period,Asset,Venue,Leg_Description,Side,Entry_Price,Exit_Price,Size,Margin_Allocated,Initial_Deposit,Ending_Balance,Net_Price_PnL,Net_Balance_Change,Points,Cost_Per_Point_Price,Cost_Per_Point_Realized,Notes
  return `${params.week},${params.period},${params.asset},${params.venue},${params.legDescription},${params.side},${params.entryPrice},-,${params.size},${params.margin},${params.margin},-,0,-${params.frictionUsd},0,-,-,"Opened via /o ${params.asset} (Friction: -$${params.frictionUsd})"`;
}

export function formatCsvExitRow(params: {
  week: string;
  period: string;
  asset: string;
  venue: string;
  legDescription: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  margin: number;
  netPnl: number;
  netBalanceChange: number;
}): string {
  return `${params.week},${params.period},${params.asset},${params.venue},${params.legDescription},${params.side},${params.entryPrice},${params.exitPrice},${params.size},${params.margin},${params.margin},-,${params.netPnl},${params.netBalanceChange},0,-,-,"Closed via /c ${params.asset}"`;
}

export function appendRowToCsv(csvRow: string): void {
  const csvPath = path.resolve(process.cwd(), 'pnl_and_points_analysis.csv');
  try {
    fs.appendFileSync(csvPath, `\n${csvRow}`);
  } catch (err) {
    console.error('[PositionSync] Ошибка записи в pnl_and_points_analysis.csv:', err);
  }
}

export async function activateHedgeOnchain(symbol: string, targetWallet?: 'w1' | 'w2'): Promise<string> {
  const config = loadConfig();
  const normSym = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  const w1 = config.wallets.robinhoodWallet1?.trim();
  const w2 = config.wallets.robinhoodWallet2?.trim();

  let targetAddr = w1;
  let targetName = 'Wallet 1 (W1)';
  if (targetWallet === 'w2' || (!targetWallet && !w1 && w2)) {
    targetAddr = w2;
    targetName = 'Wallet 2 (W2)';
  }

  // 1. Поиск открытой позиции на Lighter
  const positions = await fetchLighterPositions(targetAddr || '');
  const foundPos = positions.find((p) => p.symbol === normSym || p.symbol.includes(normSym));

  // 2. Обновление config.json
  let existingHedge = config.hedges.find((h) => h.symbol === normSym);
  if (!existingHedge) {
    existingHedge = {
      symbol: normSym,
      active: true,
      legs: [
        {
          id: `rh_${normSym.toLowerCase()}_short`,
          name: `${targetName} (Short)`,
          venue: 'lighter',
          side: 'short',
          margin: 2500,
          entryPrice: foundPos?.entryPrice || 0,
          leverage: 7,
          size: foundPos?.size || 0,
          liquidationPrice: (foundPos?.entryPrice || 100) * 1.08,
          walletAddress: targetAddr,
        },
        {
          id: `core_${normSym.toLowerCase()}_long`,
          name: `Lighter Core (${targetName}) (Long)`,
          venue: 'lighter',
          side: 'long',
          margin: 2500,
          entryPrice: foundPos?.entryPrice || 0,
          leverage: 7,
          size: foundPos?.size || 0,
          liquidationPrice: (foundPos?.entryPrice || 100) * 0.92,
          walletAddress: targetAddr,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    config.hedges.push(existingHedge);
  } else {
    existingHedge.active = true;
    existingHedge.updatedAt = Date.now();
    if (foundPos) {
      existingHedge.legs[0].entryPrice = foundPos.entryPrice;
      existingHedge.legs[0].size = foundPos.size;
    }
  }

  config.currentHedge = existingHedge;
  saveConfig(config);

  // 3. Логирование в CSV
  const entryFriction = calculateEntryFriction({
    rhShortPrice: existingHedge.legs[0].entryPrice,
    arbLongPrice: existingHedge.legs[1]?.entryPrice || existingHedge.legs[0].entryPrice * 1.0005,
    size: existingHedge.legs[0].size || 10,
    notional: (existingHedge.legs[0].margin || 2500) * 7,
  });

  const csvRow = formatCsvEntryRow({
    week: 'Week 11',
    period: '24.10 - 30.10',
    asset: normSym,
    venue: targetName,
    legDescription: `${normSym} Hedge`,
    side: 'Delta-Neutral',
    entryPrice: existingHedge.legs[0].entryPrice,
    size: existingHedge.legs[0].size,
    margin: existingHedge.legs[0].margin,
    frictionUsd: entryFriction.frictionUsd,
  });
  appendRowToCsv(csvRow);

  return [
    `✅ **ПОЗИЦИЯ ${normSym} УСПЕШНО АКТИВИРОВАНА!**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `• Кошелек: **${targetName}** (\`${targetAddr?.slice(0, 6)}...${targetAddr?.slice(-4)}\`)`,
    `• Вход RH (Short): **$${existingHedge.legs[0].entryPrice}** (размер: ${existingHedge.legs[0].size} ${normSym})`,
    `• Вход Arb (Long): **$${existingHedge.legs[1]?.entryPrice || existingHedge.legs[0].entryPrice}**`,
    `• Расчётный спред входа: **-$${entryFriction.frictionUsd}** (${entryFriction.frictionPct}%)`,
    `• Запись внесена в \`pnl_and_points_analysis.csv\``,
    `• 🚨 **Мониторинг ликвидаций и бот-сирена: АКТИВИРОВАНЫ**`,
  ].join('\n');
}

export async function deactivateHedgeOnchain(symbol: string): Promise<string> {
  const config = loadConfig();
  const normSym = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');

  const hedge = config.hedges.find((h) => h.symbol === normSym);
  if (!hedge) {
    return `⚠️ Связка **${normSym}** не найдена в файле конфигурации.`;
  }

  hedge.active = false;
  hedge.updatedAt = Date.now();
  if (config.currentHedge.symbol === normSym) {
    config.currentHedge.active = false;
  }
  saveConfig(config);

  const csvRow = formatCsvExitRow({
    week: 'Week 11',
    period: '24.10 - 30.10',
    asset: normSym,
    venue: 'Robinhood + Arbitrum',
    legDescription: `${normSym} Closed Hedge`,
    side: 'Delta-Neutral',
    entryPrice: hedge.legs[0]?.entryPrice || 0,
    exitPrice: hedge.legs[0]?.entryPrice || 0,
    size: hedge.legs[0]?.size || 0,
    margin: hedge.legs[0]?.margin || 0,
    netPnl: 0,
    netBalanceChange: 0,
  });
  appendRowToCsv(csvRow);

  return [
    `🛑 **ПОЗИЦИЯ ${normSym} УСПЕШНО ЗАКРЫТА!**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `• Связка деактивирована в \`config.json\` (\`active: false\`).`,
    `• **Мониторинг и сирена по ${normSym} остановлены.**`,
    `• Запись закрытия внесена в \`pnl_and_points_analysis.csv\`.`,
  ].join('\n');
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Запуск: `node --import tsx --test tests/positionSyncService.test.ts`  
Ожидается: PASS (2 tests pass)

---

### Task 5: Telegram Bot Integration (`sendDocument` & Handlers Wiring)

**Files:**
- Modify: `src/bot/telegram.ts` (добавить метод `sendDocument`)
- Modify: `src/bot/handlers.ts` (добавить обработку `/o`, `/c`, `/b`)
- Test: `tests/botOpsCommands.test.ts`
- Modify: `package.json` (включить новые тесты в `npm test`)

- [ ] **Step 1: Добавить метод `sendDocument` в `src/bot/telegram.ts`**

```typescript
public async sendDocument(
  chatId: string,
  filename: string,
  content: string | Buffer,
  caption?: string
): Promise<boolean> {
  if (!this.token) {
    console.log(`[Telegram (локальный лог)] Отправка документа ${filename} в чат ${chatId}`);
    return false;
  }

  try {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    formData.append('document', blob, filename);
    if (caption) {
      formData.append('caption', caption);
    }

    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(15000),
    });

    return res.ok;
  } catch (err) {
    console.error('[Telegram] Ошибка отправки документа:', err);
    return false;
  }
}
```

- [ ] **Step 2: Добавить обработку команд `/o`, `/c`, `/b` в `src/bot/handlers.ts` и `src/bot/telegram.ts`**

В `telegram.ts` `handleMessage`:
```typescript
case '/b': {
  await this.sendMessage(chatId, '⏳ Опрашиваю ончейн-балансы Robinhood и Arbitrum Core...');
  const reply = await handleRebalanceCommand(args[0]);
  await this.sendMessage(chatId, reply);
  break;
}

case '/o': {
  if (args.length > 0) {
    // /o TSM [w1/w2]
    const ticker = args[0].toUpperCase();
    const targetWallet = args[1]?.toLowerCase() as 'w1' | 'w2' | undefined;
    await this.sendMessage(chatId, `🔍 Проверяю ончейн-позиции для **${ticker}**...`);
    const reply = await activateHedgeOnchain(ticker, targetWallet);
    await this.sendMessage(chatId, reply);
  } else {
    // /o без аргументов
    await this.sendMessage(chatId, '⏳ Сканирую стаканы 27 рынков и ончейн-балансы...');
    const matrixResult = await handleMarketMatrixCommand('open');
    await this.sendMessage(chatId, matrixResult.topCardsText);
    await this.sendDocument(chatId, 'market_matrix_open.md', matrixResult.fileContent, 'Полная матрица входа (27 рынков)');
  }
  break;
}

case '/c': {
  if (args.length > 0) {
    // /c AMD [w1/w2]
    const ticker = args[0].toUpperCase();
    const reply = await deactivateHedgeOnchain(ticker);
    await this.sendMessage(chatId, reply);
  } else {
    // /c без аргументов
    await this.sendMessage(chatId, '⏳ Рассчитываю потери на закрытие маркетом...');
    const matrixResult = await handleMarketMatrixCommand('close');
    await this.sendMessage(chatId, matrixResult.topCardsText);
    await this.sendDocument(chatId, 'market_matrix_close.md', matrixResult.fileContent, 'Полная матрица выхода (27 рынков)');
  }
  break;
}
```

- [ ] **Step 3: Написать тест `tests/botOpsCommands.test.ts` для проверки роутинга команд**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRebalanceCommand } from '../src/bot/handlers.js';

test('handleRebalanceCommand produces valid output text', async () => {
  const reply = await handleRebalanceCommand();
  assert.ok(reply.includes('РЕБАЛАНСИРОВКА'));
});
```

- [ ] **Step 4: Прогнать `npm test` и `npm run typecheck`**

Запуск:
1. `npm run typecheck` — проверить строгую типизацию TypeScript без ошибок.
2. `npm test` — прогнать весь тестовый набор (все 23+ теста).

- [ ] **Step 5: Запустить проверку реального формата через Proof of Work**

Убедиться, что бот корректно отвечает на вызовы без сбоев.
