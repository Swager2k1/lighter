import type { Side } from '../types.js';
import { lighterGet, type LighterVenue } from '../connectors/lighter.js';

interface Trade {
  trade_id: number;
  trade_id_str?: string;
  timestamp: number;
  size: string;
  price: string;
  usd_amount: string;
  ask_account_id: number;
  bid_account_id: number;
  is_maker_ask: boolean;
  maker_position_size_before?: string;
  taker_position_size_before?: string;
  maker_fee?: number;
  taker_fee?: number;
  type?: string;
}

const quantityTolerance = 1e-8;
const hourMs = 3_600_000;

export function reconstructClosedCycle(trades: Trade[], account: number, side: Side, registeredAt: number) {
  const ordered = [...new Map(trades.map((trade) => [trade.trade_id_str ?? String(trade.trade_id), trade])).values()]
    .sort((a, b) => b.timestamp - a.timestamp || b.trade_id - a.trade_id);
  const direction = side === 'long' ? 1 : -1;
  let positionAfter = 0;
  let entryCash = 0;
  let exitCash = 0;
  let openedSize = 0;
  let closedSize = 0;
  let fees = 0;
  let liquidatedSize = 0;
  const positionChanges: { time: number; units: number }[] = [];

  for (const trade of ordered) {
    const sell = trade.ask_account_id === account;
    if (sell === (trade.bid_account_id === account) || typeof trade.is_maker_ask !== 'boolean') return null;
    const maker = sell === trade.is_maker_ask;
    const before = Number(maker ? trade.maker_position_size_before : trade.taker_position_size_before);
    const size = Number(trade.size);
    const cash = Number(trade.usd_amount);
    const feeRate = Number((maker ? trade.maker_fee : trade.taker_fee) ?? 0);
    const change = sell ? -size : size;
    if (!(size > 0 && cash > 0 && Number.isFinite(cash) && Number.isFinite(feeRate)) ||
        !Number.isFinite(before) || Math.abs(before + change - positionAfter) > quantityTolerance ||
        before * direction < -quantityTolerance) return null;
    if (change * direction > 0) {
      openedSize += size;
      entryCash += cash;
    } else {
      closedSize += size;
      exitCash += cash;
      if (trade.type === 'liquidation') liquidatedSize += size;
    }
    fees += cash * feeRate / 1_000_000;
    positionChanges.push({ time: trade.timestamp, units: change });
    positionAfter = before;
    if (Math.abs(before) <= quantityTolerance) {
      const openedAt = trade.timestamp;
      const closedAt = ordered[0].timestamp;
      if (openedAt > registeredAt || closedAt < registeredAt || !openedSize || Math.abs(openedSize - closedSize) > quantityTolerance) return null;
      return {
        id: ordered[0].trade_id_str ?? String(ordered[0].trade_id),
        openedAt, closedAt, size: openedSize, side, liquidatedSize,
        entryPrice: entryCash / openedSize, exitPrice: exitCash / closedSize,
        pricePnl: (exitCash - entryCash) * direction,
        fees: Number(fees.toFixed(8)),
        positionChanges: positionChanges.reverse(),
      };
    }
  }
  return null;
}

export async function readClosedCycle(venue: LighterVenue, account: number, market: number, side: Side, registeredAt: number) {
  const trades: Trade[] = [];
  const params = new URLSearchParams({ account_index: String(account), market_id: String(market), limit: '100', sort_by: 'timestamp' });
  for (let page = 0; page < 12; page++) {
    const response = await lighterGet<{ trades: (Trade & { market_id: number })[]; next_cursor?: string }>(venue, 'trades', params);
    if (!Array.isArray(response.trades) || response.trades.some((trade) => trade.market_id !== market)) throw new Error('Invalid trade history');
    trades.push(...response.trades);
    const cycle = reconstructClosedCycle(trades, account, side, registeredAt);
    if (cycle) return cycle;
    if (!response.next_cursor || response.next_cursor === params.get('cursor') || !response.trades.length) break;
    params.set('cursor', response.next_cursor);
  }
  return null;
}

export async function estimateCycleFunding(venue: LighterVenue, market: number, cycle: NonNullable<ReturnType<typeof reconstructClosedCycle>>): Promise<number | null> {
  const firstHour = (Math.floor(cycle.openedAt / hourMs) + 1) * hourMs;
  const lastHour = Math.floor(cycle.closedAt / hourMs) * hourMs;
  let funding = 0;
  let position = 0;
  let fillIndex = 0;
  for (let start = firstHour; start <= lastHour; start += 120 * hourMs) {
    const end = Math.min(lastHour, start + 119 * hourMs);
    const params = new URLSearchParams({
      market_id: String(market), resolution: '1h', start_timestamp: String(start / 1000),
      end_timestamp: String((end + hourMs) / 1000), count_back: '121',
    });
    try {
      const response = await lighterGet<{ fundings: { timestamp: number; value: string; direction: string }[] }>(venue, 'fundings', params);
      const points = new Map(response.fundings.map((point) => [point.timestamp * 1000, point]));
      for (let hour = start; hour <= end; hour += hourMs) {
        while (fillIndex < cycle.positionChanges.length && cycle.positionChanges[fillIndex].time < hour) {
          position += cycle.positionChanges[fillIndex++].units;
        }
        const point = points.get(hour);
        const value = Number(point?.value);
        if (!point || (point.direction !== 'long' && point.direction !== 'short') || !Number.isFinite(value)) return null;
        funding += value * position * (point.direction === 'long' ? -1 : 1);
      }
    } catch {
      return null;
    }
  }
  return funding;
}
