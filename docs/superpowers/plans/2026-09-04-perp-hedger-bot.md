# Perp Hedger & Risk Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить автономный, надежный сервис с интерактивным Telegram-ботом для дельта-нейтрального хеджирования (1 Long Lighter vs 1 Short Lighter + 1 Short Polymarket) с поддержкой 29 общих рынков, анализом безопасного плеча на 24ч/7дней и 100% Anti-Sybil защитой (Zero-Trace polling + On-Demand stealth sync).

**Architecture:** Модульный сервис на TypeScript (Node.js 20+). Коннекторы опрашивают публичные REST API Lighter (`api.rh.lighter.xyz`) и Polymarket (`api.perpetuals.polymarket.com`). Риск-движок локально отслеживает сквизы (скользящее окно тиков), дистанцию до ликвидаций с учетом MMR бирж (6.0% Lighter, 5.0% Polymarket) и фандинг. Интерактивный Telegram-бот управляется командами (`/status`, `/markets`, `/calc`, `/sync`, `/poly`) и отправляет экстренные алерты при рисках.

**Tech Stack:** TypeScript, Node.js 20+, `dotenv`, `node:test` (встроенный тестовый раннер Node.js без лишних зависимостей), Telegram Bot API.

---

### Task 1: Project Setup & Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `config.json`
- Create: `src/types.ts`

- [ ] **Step 1: Create package.json and tsconfig.json**
Configure TypeScript with ESM and modern target, script definitions for build and test.

- [ ] **Step 2: Create src/types.ts**
Define interfaces: `Position`, `ThreeLegHedge`, `MarketInfo`, `TickerSnapshot`, `SpikeAlert`, `RiskAssessment`, `CalculatorResult`.

- [ ] **Step 3: Create default config.json and .env.example**
Structure the settings for default asset (`TSM`), alert thresholds (Warning: 5%, Critical: 2.5%, Spike: 1.5%), and 3-leg configuration.

- [ ] **Step 4: Verify type check passes**
Run: `& "C:\Program Files\nodejs\node.exe" --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit`
Expected: clean exit (0 errors).

---

### Task 2: Exchange Connectors (Lighter & Polymarket)

**Files:**
- Create: `src/connectors/lighter.ts`
- Create: `src/connectors/polymarket.ts`
- Test: `tests/connectors.test.ts`

- [ ] **Step 1: Write test for connectors fetching public market data**
Verify that `fetchLighterTicker('TSM')` and `fetchPolymarketTicker('TSM-USD')` return valid numbers.

- [ ] **Step 2: Implement src/connectors/lighter.ts**
Fetch public order book details from `https://api.rh.lighter.xyz/api/v1/orderBookDetails`, and single-shot positions from `https://explorerapi.rh.lighter.xyz/api/accounts/{address}/positions` with randomized jitter delay.

- [ ] **Step 3: Implement src/connectors/polymarket.ts**
Fetch instruments and tickers from `https://api.perpetuals.polymarket.com/v1/info/instruments` and `/tickers`.

- [ ] **Step 4: Run test to verify passes**
Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test tests/connectors.test.ts`
Expected: PASS.

---

### Task 3: Market Scanner (29 Shared Markets)

**Files:**
- Create: `src/services/marketScanner.ts`
- Test: `tests/marketScanner.test.ts`

- [ ] **Step 1: Write test for market matching**
Verify that market scanner matches `TSM`, `NVDA`, `BTC`, `ETH`, etc. and computes price spreads & funding differentials.

- [ ] **Step 2: Implement src/services/marketScanner.ts**
Cross-reference Lighter symbols and Polymarket instruments, calculate funding spread (annualized and 24h), and return sorted opportunities.

- [ ] **Step 3: Run test to verify passes**
Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test tests/marketScanner.test.ts`
Expected: PASS.

---

### Task 4: Risk Engine & Spike Detector

**Files:**
- Create: `src/services/riskEngine.ts`
- Create: `src/services/spikeDetector.ts`
- Test: `tests/riskEngine.test.ts`

- [ ] **Step 1: Write test for liquidation calculations and spike detection**
Test MMR formulas:
- Lighter: $P_{liq} = P_{entry} \times (1 \pm (1/L - 0.06))$
- Polymarket: $P_{liq} = P_{entry} \times (1 \pm (1/L - 0.05))$
- Ring buffer spike detection: >1.5% in 2 minutes.

- [ ] **Step 2: Implement src/services/riskEngine.ts**
Implement exact distance to liquidation, PnL computation, and overall delta calculation.

- [ ] **Step 3: Implement src/services/spikeDetector.ts**
Maintain a 5-minute ring buffer of price ticks. Trigger alerts on rapid spikes.

- [ ] **Step 4: Run test to verify passes**
Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test tests/riskEngine.test.ts`
Expected: PASS.

---

### Task 5: Leverage & Volatility Calculator (/calc)

**Files:**
- Create: `src/services/calculator.ts`
- Test: `tests/calculator.test.ts`

- [ ] **Step 1: Write test for safe leverage calculation**
Verify that for TSM (daily volatility ~2.14%), 6x leverage is assessed as safe for 24h (10.67% cushion > 5-sigma daily move), while for 7 days 4x-5x is recommended.

- [ ] **Step 2: Implement src/services/calculator.ts**
Implement statistical volatility / historical move estimation, leverage evaluation, and margin split recommendations across the 3 legs.

- [ ] **Step 3: Run test to verify passes**
Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test tests/calculator.test.ts`
Expected: PASS.

---

### Task 6: Interactive Telegram Bot & Notification Dispatcher

**Files:**
- Create: `src/bot/telegram.ts`
- Create: `src/bot/handlers.ts`
- Test: `tests/botHandlers.test.ts`

- [ ] **Step 1: Write test for command formatters**
Test `/status`, `/markets`, `/calc`, `/funding` message generation with mocked data.

- [ ] **Step 2: Implement Telegram client & handlers**
Support commands:
- `/status` — real-time health of the 3-leg hedge.
- `/markets` — table of 29 common markets with funding comparison.
- `/select <symbol>` — switch active market.
- `/calc <symbol> <margin> [days]` — leverage & volatility advisor.
- `/sync` — one-time stealth sync of exact fill prices from explorer with jitter.
- `/poly <address>` — update dynamic Polymarket wallet.
- `/funding` — funding rate breakdown.
- `/mute [minutes]` — pause alert spam during rebalancing.

- [ ] **Step 3: Implement smart alert dispatcher with anti-spam cooldown**
Prevent duplicate warnings within 15 minutes unless severity escalates to Critical.

---

### Task 7: Main Entrypoint & Background Monitor Loop

**Files:**
- Create: `src/index.ts`
- Create: `README.md`

- [ ] **Step 1: Implement src/index.ts**
Launch Telegram polling, initialize market scanner, and start the 15-second anonymous public market price monitor loop.

- [ ] **Step 2: Write README.md with clear quickstart instructions**
Step-by-step guide on obtaining Telegram Bot Token via @BotFather, configuring `.env`, and running the bot.

- [ ] **Step 3: Full Project Proof of Work**
Run: `& "C:\Program Files\nodejs\node.exe" --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit`
Run: `& "C:\Program Files\nodejs\node.exe" --import tsx --test tests/*.test.ts`
Expected: 0 type errors, all unit tests PASS.
