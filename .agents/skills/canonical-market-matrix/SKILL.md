---
name: canonical-market-matrix
description: Protocol for generating the canonical Lighter market matrix with live wallet balance fetching and dynamic 100% and 50% market entry loss calculations
---

# Canonical Market Matrix Skill (Lighter Hedge & Points Optimizer)

## Назначение
Этот навык регламентирует сбор данных, симуляцию стаканов и генерацию канонической таблицы рынка для дельта-нейтрального хеджирования между **Robinhood Chain (Lighter)** и **Arbitrum zkLighter**.

Главная цель — максимизация начисления поинтов Lighter на вложенный доллар маржи с минимальными издержками на спреде и проскальзывании.

---

## ⚡️ Железное правило: Zero Stale Balances (Никаких устаревших балансов)
**КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО** использовать статические или ранее сохраненные значения депозитов (например, $7 312 прошлой недели или статичный объем $20 000).  
Перед формированием таблицы агент/скрипт **ОБЯЗАН** выполнить живой ончейн-запрос к API обеих сетей.

---

## Фаза 1. Ончейн-аудит депозитов (Live Balances)

### 1.1. Запрос балансов аккаунтов
Берутся адреса кошельков из `config.json` (`wallets.robinhoodWallet1` и `wallets.robinhoodWallet2`).

Для каждого кошелька выполняются запросы:
- **Robinhood Chain API:**
  ```http
  GET https://api.rh.lighter.xyz/api/v1/account?by=l1_address&value={walletAddress}
  ```
- **Arbitrum zkLighter API:**
  ```http
  GET https://mainnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value={walletAddress}
  ```

### 1.2. Извлечение Equity
Из ответа парсится поле `accounts[0].total_asset_value` (или `accounts[0].collateral`, если позиций нет).
$$\text{Total Equity} = \text{RH Equity} + \text{Arb Equity}$$

---

## Фаза 2. Математика динамического сайзинга (7x плечо)

Для целевого кошелька (обычно W1, либо свободного от позиций):
1. **Сценарий 100% (All-in в 1 пару с 7x плечом):**
   $$\text{Margin per leg}_{100\%} = \frac{\text{Total Equity}}{2}$$
   $$\text{Notional}_{100\%} = \text{Margin per leg}_{100\%} \times 7$$

2. **Сценарий 50% (Сплит на 2 пары по 50% капитала с 7x плечом):**
   $$\text{Margin per leg}_{50\%} = \frac{\text{Total Equity}}{4}$$
   $$\text{Notional}_{50\%} = \text{Margin per leg}_{50\%} \times 7$$

*(Размер 50% от W1 обычно в точности совпадает со 100% входом на кошельке W2).*

---

## Фаза 3. Запрос стаканов и симуляция прохода (Orderbook Walk)

### 3.1. Эндпоинты
- **Список рынков и деталей:**
  - `https://api.rh.lighter.xyz/api/v1/orderBookDetails`
  - `https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails`
- **Глубина стакана (50 уровней):**
  - `https://api.rh.lighter.xyz/api/v1/orderBookOrders?market_id={id}&limit=50`
  - `https://mainnet.zklighter.elliot.ai/api/v1/orderBookOrders?market_id={id}&limit=50`

### 3.2. Алгоритм для вектора Robinhood Short + Arbitrum Long
1. **Robinhood Short:** продажа по заявкам на покупку (`rhBids`).
2. **Arbitrum Long:** покупка по заявкам на продажу (`arbAsks`).
3. Для каждого уровня стакана накапливается исполненный объем в долларах до достижения целевого `Notional`.
4. Вычисляются средневзвешенные цены исполнения $\bar{P}_{\text{RH Sell}}$ и $\bar{P}_{\text{Arb Buy}}$.
5. **Совокупные потери на входе:**
   $$\text{Loss} = (\bar{P}_{\text{Arb Buy}} - \bar{P}_{\text{RH Sell}}) \times \text{BaseQty}$$
   $$\text{Loss \%} = \frac{\text{Loss}}{\text{Notional}} \times 100\%$$
6. Если стакан исчерпан до достижения необходимого объема, фиксируется статус `❌ Тонкий стакан (Стакан мал!)`.

---

## Фаза 4. Полный каталог активов и сортировка

В матрицу включаются **ВСЕ 27 общих фондовых активов** между Robinhood и Arbitrum:
- **Акции:** `TSM`, `BABA`, `ORCL`, `INTC`, `SKHY`, `AMD`, `META`, `MU`, `TSLA`, `AMZN`, `MSFT`, `SNDK`, `GOOGL`, `AAPL`, `NVDA`, `AI`.
- **Pre-IPO:** `SHEIN`, `CRWV`, `CRCL`, `SPCX`, `OPENAI`, `ANTHROPIC`.
- **ETF:** `SOXL`, `QQQ`, `SPY`.

Сортировка производится **СТРОГО ПО ВОЗРАСТАНИЮ `OI Robinhood ($) 🟢`**.

---

## Фаза 5. Стандарт вывода в чат

В ответе пользователю обязательно приводятся:
1. Шапка с фактическими живыми ончейн-балансами кошельков и рассчитанными суммами $\text{Notional}_{100\%}$ и $\text{Notional}_{50\%}$.
2. Полная сводная таблица по форме:
   `| Актив | Тип | Отчёт (дата/риск) | OI Robinhood ($) 🟢 | OI Arbitrum ($) | Стенки RH (Bid): L1 / L2 ($) | Стенки Arb (Ask): L1 / L2 ($) | Макс. вход в 1 стенку | Спред краёв | Влияние новостей / Геополитика и макро-риск | Потери маркетом 100% ($ и %) | Потери маркетом 50% ($ и %) | Итоговый вердикт по исполнению |`
3. Экспертный вердикт:
   - Выделение лучших тикеров (Low OI + Золотое окно отчетов 5–14 дней + глубокий стакан).
   - Предупреждения по тонким стаканам (SHEIN, AI, OPENAI, ANTHROPIC) и левериджным ETF (SOXL).
