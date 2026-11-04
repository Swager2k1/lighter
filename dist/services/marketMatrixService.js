import { getEarningsInfo, getReportingWeekInterval } from './calendarService.js';
import { fetchLiveWalletEquity } from './rebalanceService.js';
import { loadConfig, getActiveHedges } from '../config.js';
export const KNOWN_STOCKS = new Set([
    'AAPL', 'AMD', 'AMZN', 'BABA', 'COIN', 'GOOGL', 'INTC', 'META', 'MSFT',
    'MU', 'NVDA', 'ORCL', 'PLTR', 'SKHY', 'SNDK', 'TSLA', 'TSM', 'BMNR'
]);
export const KNOWN_PRE_IPO = new Set([
    'SHEIN', 'CRWV', 'CRCL', 'SPCX', 'OPENAI', 'ANTHROPIC'
]);
export const KNOWN_ETF = new Set([
    'QQQ', 'SPY', 'SOXL', 'SPX', 'IWM'
]);
export const KNOWN_COMMODITIES = new Set([
    'XAU', 'XAG', 'WTI', 'BRENTOIL', 'NATGAS'
]);
const ASSET_MACRO_INFO = {
    MSFT: '🟡 Azure Cloud / AI Capex',
    GOOGL: '🟡 Антимонополия / Поисковый AI',
    AMZN: '🟡 AWS / E-commerce',
    COIN: '🟡 Крипто-рынок / ETF объемы',
    INTC: '🟡 Реструктуризация / Foundry',
    AAPL: '🟡 Спрос iPhone / Услуги',
    PLTR: '🟡 AI оборонка / Государственные контракты',
    AMD: '🟡 Конкуренция GPU / Дата-центры',
    NVDA: '🟡 Лидер AI / Blackwell спрос',
    META: '🟢 Capex AI / Рекламная выручка',
    TSLA: '🟢 Robotaxi / Спрос на EV',
    TSM: '🟢 CHIPS / Передовые узлы',
    ORCL: '🟢 Безопасно (Cloud / AI)',
    BABA: '🟡 Пошлины США-КНР / Стимулы',
    MU: '🟢 Цикл памяти DRAM / HBM',
    SKHY: '🟢 HBM спрос (Nvidia партнер)',
    SNDK: '🟢 Флеш-память / Стабильно',
    BMNR: '🟡 Майнинг / Хэшрейт BTC',
    SHEIN: '🔴 Тонкий стакан / Регуляторы',
    CRWV: '🟡 Low OI / Средний стакан',
    CRCL: '🟡 Low OI / Умеренно',
    SPCX: '🟡 Космос / Low OI',
    OPENAI: '🔴 Тонкий стакан / Частные оценки',
    ANTHROPIC: '🔴 Тонкий стакан / Частные оценки',
    QQQ: '🟢 Высокая ликвидность (Nasdaq 100)',
    SPY: '🟢 Макро-базовый (S&P 500)',
    SOXL: '🔴 3x Леверидж (Повышенная волатильность)',
    XAU: '🟢 Золото / Макро-хедж',
    XAG: '🟢 Серебро / Волатильность',
};
export function isStockSymbol(symbol) {
    const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').split('/')[0];
    return KNOWN_STOCKS.has(norm);
}
export function getAssetType(symbol) {
    const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').split('/')[0];
    if (KNOWN_STOCKS.has(norm))
        return 'Stock';
    if (KNOWN_PRE_IPO.has(norm))
        return 'Pre-IPO';
    if (KNOWN_ETF.has(norm))
        return 'ETF';
    if (KNOWN_COMMODITIES.has(norm))
        return 'Commodity';
    return 'Crypto';
}
export function getAssetMacroRisk(symbol) {
    const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').split('/')[0];
    return ASSET_MACRO_INFO[norm] || '🟢 Стандартный рыночный риск';
}
export function checkIsNewListing(createdAt, weekStart) {
    if (!createdAt)
        return false;
    const ts = typeof createdAt === 'string' ? parseInt(createdAt, 10) : createdAt;
    if (!ts || isNaN(ts))
        return false;
    const ms = ts > 1e11 ? ts : ts * 1000;
    return ms >= weekStart.getTime();
}
export function validateMarketHedgeability(params) {
    const { rhDetail, arbDetail, rhBidsCount, rhAsksCount, arbBidsCount, arbAsksCount } = params;
    if (!rhDetail || !arbDetail) {
        return { isHedgeable: false, reason: 'Инструмент отсутствует на одной из бирж' };
    }
    if (rhDetail.status !== 'active' || arbDetail.status !== 'active') {
        return { isHedgeable: false, reason: `Статус не active (RH: ${rhDetail.status}, Arb: ${arbDetail.status})` };
    }
    if (rhDetail.is_frozen || arbDetail.is_frozen) {
        return { isHedgeable: false, reason: 'Рынок заморожен (is_frozen: true)' };
    }
    if (rhDetail.market_config?.force_reduce_only || arbDetail.market_config?.force_reduce_only) {
        return { isHedgeable: false, reason: 'force_reduce_only включен (запрет на открытие новых позиций)' };
    }
    const rhOi = parseFloat(String(rhDetail.open_interest || '0'));
    const arbOi = parseFloat(String(arbDetail.open_interest || '0'));
    const arbOiUsd = parseFloat(String(arbDetail.open_interest_usd || '0'));
    if (rhOi <= 0 || (arbOi <= 0 && arbOiUsd <= 0)) {
        return { isHedgeable: false, reason: `Нулевой Open Interest (RH: ${rhOi}, Arb: ${arbOi})` };
    }
    if (rhBidsCount === 0 || rhAsksCount === 0 || arbBidsCount === 0 || arbAsksCount === 0) {
        return { isHedgeable: false, reason: `Пустой стакан ордеров (RH b:${rhBidsCount} a:${rhAsksCount}, Arb b:${arbBidsCount} a:${arbAsksCount})` };
    }
    return { isHedgeable: true };
}
export function sortMarketMatrixRows(rows) {
    return [...rows].sort((a, b) => {
        // 1. Активы с бустом (🔥 отчет недели или новый листинг) идут на самом верху
        if (a.hasEarningsBoost && !b.hasEarningsBoost)
            return -1;
        if (!a.hasEarningsBoost && b.hasEarningsBoost)
            return 1;
        if (a.hasEarningsBoost && b.hasEarningsBoost) {
            // Внутри бустов: сначала акции, затем остальные
            if (a.isStock && !b.isStock)
                return -1;
            if (!a.isStock && b.isStock)
                return 1;
            // Сортировка по минимальному loss100Pct
            if (Math.abs(a.loss100Pct - b.loss100Pct) > 0.005) {
                return a.loss100Pct - b.loss100Pct;
            }
            return a.oiRobinhoodUsd - b.oiRobinhoodUsd;
        }
        // 2. Все Акции идут перед остальными рынками
        if (a.isStock && !b.isStock)
            return -1;
        if (!a.isStock && b.isStock)
            return 1;
        // 3. Внутри категории: сначала фильтрация/ранжирование по минимальному lossMarket 100%
        if (Math.abs(a.loss100Pct - b.loss100Pct) > 0.005) {
            return a.loss100Pct - b.loss100Pct;
        }
        // 4. При близком лоссе — по возрастанию Robinhood OI (максимальный фарминг поинтов)
        return a.oiRobinhoodUsd - b.oiRobinhoodUsd;
    });
}
export function calculateDynamicNotional(totalEquity, leverage = 7) {
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
export function simulateOrderbookWalk(params) {
    const { targetNotional, sellSideLevels, buySideLevels } = params;
    let remainingSellNotional = targetNotional;
    let totalSellUnits = 0;
    let totalSellCash = 0;
    for (const lvl of sellSideLevels) {
        const lvlCash = lvl.price * lvl.size;
        if (lvlCash <= 0)
            continue;
        if (remainingSellNotional <= lvlCash) {
            const units = remainingSellNotional / lvl.price;
            totalSellUnits += units;
            totalSellCash += remainingSellNotional;
            remainingSellNotional = 0;
            break;
        }
        else {
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
        if (lvlCash <= 0)
            continue;
        if (remainingBuyNotional <= lvlCash) {
            const units = remainingBuyNotional / lvl.price;
            totalBuyUnits += units;
            totalBuyCash += remainingBuyNotional;
            remainingBuyNotional = 0;
            break;
        }
        else {
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
export function formatCompactUsd(amount) {
    if (amount >= 1_000_000) {
        return `$${(amount / 1_000_000).toFixed(2)}M`;
    }
    if (amount >= 1_000) {
        return `$${(amount / 1_000).toFixed(1)}k`;
    }
    return `$${amount.toFixed(0)}`;
}
export function formatTopCardsMessage(params) {
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
        `*(Приоритет: 🔥 Бусты недели → 📈 Акции по мин. Loss 100% → 🌐 Другие пары)*`,
        `━━━━━━━━━━━━━━━━━━━━`,
    ];
    topRows.forEach((r, idx) => {
        let categoryBadge = r.isStock ? '📈 [АКЦИЯ]' : '🌐 [ДРУГОЙ РЫНОК]';
        if (r.hasEarningsBoost) {
            categoryBadge = r.isNewListing ? '🔥 [НОВЫЙ ЛИСТИНГ]' : '🔥 [БУСТ ОТЧЕТА]';
        }
        const loss100Str = r.loss100Usd <= 0 ? `+$${Math.abs(r.loss100Usd)}` : `-$${r.loss100Usd}`;
        const loss50Str = r.loss50Usd <= 0 ? `+$${Math.abs(r.loss50Usd)}` : `-$${r.loss50Usd}`;
        const loss100PctStr = r.loss100Pct <= 0 ? `+${Math.abs(r.loss100Pct)}%` : `${r.loss100Pct}%`;
        const loss50PctStr = r.loss50Pct <= 0 ? `+${Math.abs(r.loss50Pct)}%` : `${r.loss50Pct}%`;
        lines.push(`${idx + 1}. ${categoryBadge} **$${r.symbol}** (${r.earningsText})`, `   • Потери 100%: **${loss100Str}** (${loss100PctStr}) | 50%: **${loss50Str}** (${loss50PctStr})`, `   • OI RH: **${formatCompactUsd(r.oiRobinhoodUsd)}** 🟢 | OI Arb: **${formatCompactUsd(r.oiArbitrumUsd)}**`, `   • Стенки RH/Arb: **${r.wallRhL1}** / **${r.wallArbL1}** (макс 1 стенка: $${r.maxEntryWallUsd})`, `   • Спред краёв: **${r.edgeSpreadPct}%**`, `   • 💡 Вердикт: *${r.verdict}*`, ``);
    });
    lines.push(`📎 *Полная каноническая матрица по всем инструментам прикреплена в JSON файле ниже.*`);
    return lines.join('\n');
}
export function generateCanonicalJsonFile(rows, sizing) {
    const stocks = rows.filter((r) => r.isStock);
    const otherMarkets = rows.filter((r) => !r.isStock);
    const formatRow = (r, index) => {
        const loss100Str = r.loss100Usd <= 0 ? `+$${Math.abs(r.loss100Usd)} (+${Math.abs(r.loss100Pct)}%)` : `-$${r.loss100Usd} (${r.loss100Pct}%)`;
        const loss50Str = r.loss50Usd <= 0 ? `+$${Math.abs(r.loss50Usd)} (+${Math.abs(r.loss50Pct)}%)` : `-$${r.loss50Usd} (${r.loss50Pct}%)`;
        let divider = null;
        if (index === 0 && r.isStock) {
            divider = '══════════ СЕКЦИЯ АКЦИЙ (STOCKS) ══════════';
        }
        else if (index === stocks.length && !r.isStock) {
            divider = '══════════ ДРУГИЕ РЫНКИ (CRYPTO / ETF / COMMODITIES) ══════════';
        }
        return {
            ...(divider ? { divider } : {}),
            rank: index + 1,
            symbol: r.symbol,
            type: r.type,
            is_stock: r.isStock,
            has_boost: r.hasEarningsBoost,
            earnings: r.earningsText,
            days_until_earnings: r.daysUntilEarnings < 9999 ? r.daysUntilEarnings : null,
            loss_market_100pct: loss100Str,
            loss_market_50pct: loss50Str,
            oi_robinhood: formatCompactUsd(r.oiRobinhoodUsd),
            oi_arbitrum: formatCompactUsd(r.oiArbitrumUsd),
            walls_rh_bid_l1_l2: `${r.wallRhL1} / ${r.wallRhL2}`,
            walls_arb_ask_l1_l2: `${r.wallArbL1} / ${r.wallArbL2}`,
            max_entry_wall_usd: `$${r.maxEntryWallUsd}`,
            edge_spread_pct: `${r.edgeSpreadPct}%`,
            macro_risk: r.macroRisk,
            verdict: r.verdict,
        };
    };
    const data = {
        generated_at: new Date().toLocaleString(),
        portfolio_equity_usd: sizing.totalEquity,
        notional_100pct_7x_usd: sizing.notional100Pct,
        notional_50pct_7x_usd: sizing.notional50Pct,
        total_markets: rows.length,
        total_stocks: stocks.length,
        total_other_markets: otherMarkets.length,
        stocks_section: stocks.map((r, idx) => formatRow(r, idx)),
        other_markets_section: otherMarkets.map((r, idx) => formatRow(r, idx)),
        markets: rows.map((r, idx) => formatRow(r, idx)),
    };
    return JSON.stringify(data, null, 2);
}
export function generateCanonicalMarkdownFile(rows, sizing) {
    return generateCanonicalJsonFile(rows, sizing);
}
export async function fetchOrderBookOrders(venue, marketId, limit = 50) {
    const baseUrl = venue === 'rh' ? 'https://api.rh.lighter.xyz' : 'https://mainnet.zklighter.elliot.ai';
    const url = `${baseUrl}/api/v1/orderBookOrders?market_id=${marketId}&limit=${limit}`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok)
            return { bids: [], asks: [] };
        const data = (await res.json());
        const rawBids = data.bids || data.order_book_orders?.bids || [];
        const rawAsks = data.asks || data.order_book_orders?.asks || [];
        const bids = rawBids.map((b) => ({
            price: parseFloat(b.price) || 0,
            size: parseFloat(b.remaining_base_amount || b.initial_base_amount || b.size || '0') || 0,
        }));
        const asks = rawAsks.map((a) => ({
            price: parseFloat(a.price) || 0,
            size: parseFloat(a.remaining_base_amount || a.initial_base_amount || a.size || '0') || 0,
        }));
        return { bids, asks };
    }
    catch {
        return { bids: [], asks: [] };
    }
}
export async function scanCanonicalMarketMatrix(mode = 'open', targetWalletArg) {
    const config = loadConfig();
    const w1Addr = config.wallets.robinhoodWallet1?.trim() || '';
    const w2Addr = config.wallets.robinhoodWallet2?.trim() || '';
    // 1. Live Audit Балансов
    const [w1Live, w2Live] = await Promise.all([
        w1Addr ? fetchLiveWalletEquity(w1Addr) : Promise.resolve({ rhEquity: 0, rhCollateral: 0, arbEquity: 0, arbCollateral: 0 }),
        w2Addr ? fetchLiveWalletEquity(w2Addr) : Promise.resolve({ rhEquity: 0, rhCollateral: 0, arbEquity: 0, arbCollateral: 0 }),
    ]);
    const activeHedges = getActiveHedges(config);
    const w1Active = activeHedges.some((h) => h.legs.some((l) => l.walletAddress?.toLowerCase() === w1Addr.toLowerCase()));
    const w2Active = activeHedges.some((h) => h.legs.some((l) => l.walletAddress?.toLowerCase() === w2Addr.toLowerCase()));
    let selectedWallet = targetWalletArg || 'all';
    if (!targetWalletArg) {
        if (w1Active && !w2Active) {
            selectedWallet = 'w2';
        }
        else if (!w1Active && w2Active) {
            selectedWallet = 'w1';
        }
        else if (w2Addr && !w1Addr) {
            selectedWallet = 'w2';
        }
        else {
            selectedWallet = 'w1';
        }
    }
    const w1Total = parseFloat((w1Live.rhEquity + w1Live.arbEquity).toFixed(2));
    const w2Total = parseFloat((w2Live.rhEquity + w2Live.arbEquity).toFixed(2));
    const combinedTotal = parseFloat((w1Total + w2Total).toFixed(2));
    let targetEquity;
    let targetWalletLabel;
    if (selectedWallet === 'w2') {
        targetEquity = w2Total > 0 ? w2Total : 4900;
        targetWalletLabel = `🎯 Расчёт для: **Wallet 2 (W2)** (ончейн: **$${targetEquity.toFixed(2)}**)`;
    }
    else if (selectedWallet === 'w1') {
        targetEquity = w1Total > 0 ? w1Total : 9800;
        targetWalletLabel = `🎯 Расчёт для: **Wallet 1 (W1)** (ончейн: **$${targetEquity.toFixed(2)}**)`;
    }
    else {
        targetEquity = combinedTotal > 0 ? combinedTotal : 15000;
        targetWalletLabel = `🎯 Расчёт для: **Весь портфель (W1 + W2)** ($${targetEquity.toFixed(2)})`;
    }
    const sizing = calculateDynamicNotional(targetEquity, 7);
    const walletsSummary = [
        `• W1 (Total $${w1Total.toFixed(2)}): RH $${w1Live.rhEquity.toFixed(2)} | Arb $${w1Live.arbEquity.toFixed(2)}${w1Active ? ' 🔒 (Занят)' : ' 🟢 (Свободен)'}`,
        `• W2 (Total $${w2Total.toFixed(2)}): RH $${w2Live.rhEquity.toFixed(2)} | Arb $${w2Live.arbEquity.toFixed(2)}${w2Active ? ' 🔒 (Занят)' : ' 🟢 (Свободен)'}`,
        targetWalletLabel,
    ].join('\n');
    // 2. Динамический запрос реестра рынков с обеих бирж
    const [rhBooksRes, arbBooksRes] = await Promise.allSettled([
        fetch('https://api.rh.lighter.xyz/api/v1/orderBookDetails', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(7000),
        }).then((r) => r.json()),
        fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(7000),
        }).then((r) => r.json()),
    ]);
    const rhDetails = (rhBooksRes.status === 'fulfilled' && rhBooksRes.value?.order_book_details) || [];
    const arbDetails = (arbBooksRes.status === 'fulfilled' && arbBooksRes.value?.order_book_details) || [];
    const rhMap = new Map(rhDetails.map((b) => [b.symbol.toUpperCase(), b]));
    const arbMap = new Map(arbDetails.map((b) => [b.symbol.toUpperCase(), b]));
    // Определение интервала текущей отчетной недели
    const now = new Date();
    const weekInterval = getReportingWeekInterval(now);
    // Находим пересекающиеся символы
    const candidateSymbols = [];
    for (const sym of rhMap.keys()) {
        if (arbMap.has(sym)) {
            candidateSymbols.push(sym);
        }
    }
    // 3. Сканирование стаканов и 9-факторная валидация
    const rows = [];
    // Выполняем пачками по 8 запросов для стабильности соединений
    const BATCH_SIZE = 8;
    for (let i = 0; i < candidateSymbols.length; i += BATCH_SIZE) {
        const chunk = candidateSymbols.slice(i, i + BATCH_SIZE);
        await Promise.all(chunk.map(async (sym) => {
            const rhInfo = rhMap.get(sym);
            const arbInfo = arbMap.get(sym);
            // Предварительная проверка параметров рынка
            if (rhInfo.status !== 'active' ||
                arbInfo.status !== 'active' ||
                rhInfo.is_frozen ||
                arbInfo.is_frozen ||
                rhInfo.market_config?.force_reduce_only ||
                arbInfo.market_config?.force_reduce_only) {
                return;
            }
            const [rhOb, arbOb] = await Promise.all([
                fetchOrderBookOrders('rh', rhInfo.market_id, 50),
                fetchOrderBookOrders('arb', arbInfo.market_id, 50),
            ]);
            const validation = validateMarketHedgeability({
                rhDetail: rhInfo,
                arbDetail: arbInfo,
                rhBidsCount: rhOb.bids.length,
                rhAsksCount: rhOb.asks.length,
                arbBidsCount: arbOb.bids.length,
                arbAsksCount: arbOb.asks.length,
            });
            if (!validation.isHedgeable) {
                return;
            }
            const rhBids = rhOb.bids;
            const rhAsks = rhOb.asks;
            const arbBids = arbOb.bids;
            const arbAsks = arbOb.asks;
            const rhPrice = parseFloat(rhInfo.mark_price || '0') || (typeof rhInfo.last_trade_price === 'number' ? rhInfo.last_trade_price : 0) || 1;
            const arbPrice = parseFloat(arbInfo.mark_price || '0') || (typeof arbInfo.last_trade_price === 'number' ? arbInfo.last_trade_price : 0) || 1;
            const rawRhOi = typeof rhInfo.open_interest === 'number' ? rhInfo.open_interest : parseFloat(rhInfo.open_interest || '0');
            const oiRh = Math.round(rawRhOi * rhPrice * 2);
            const apiArbOiUsd = typeof arbInfo.open_interest_usd === 'number'
                ? arbInfo.open_interest_usd
                : parseFloat(String(arbInfo.open_interest_usd || '0'));
            const rawArbOi = typeof arbInfo.open_interest === 'number' ? arbInfo.open_interest : parseFloat(arbInfo.open_interest || '0');
            const oiArb = apiArbOiUsd > 0 ? Math.round(apiArbOiUsd) : Math.round(rawArbOi * arbPrice * 2);
            // Бусты:
            // А. Квартальный отчет на текущей неделе
            const earnings = getEarningsInfo(sym, now);
            // Б. Новый листинг текущей недели (created_at >= weekStart)
            const isNewListing = checkIsNewListing(rhInfo.created_at, weekInterval.start) || checkIsNewListing(arbInfo.created_at, weekInterval.start);
            const hasBoost = earnings.boost || isNewListing;
            let earningsText = earnings.displayColumn;
            if (isNewListing) {
                earningsText = '🔥 НОВЫЙ ЛИСТИНГ НЕДЕЛИ';
            }
            const isStock = isStockSymbol(sym);
            const assetType = getAssetType(sym);
            const macro = getAssetMacroRisk(sym);
            const wallRhL1 = `$${rhBids[0].price} ($${Math.round(rhBids[0].price * rhBids[0].size)})`;
            const wallRhL2 = rhBids[1] ? `$${rhBids[1].price} ($${Math.round(rhBids[1].price * rhBids[1].size)})` : '—';
            const wallArbL1 = `$${arbAsks[0].price} ($${Math.round(arbAsks[0].price * arbAsks[0].size)})`;
            const wallArbL2 = arbAsks[1] ? `$${arbAsks[1].price} ($${Math.round(arbAsks[1].price * arbAsks[1].size)})` : '—';
            const rhL1Cash = rhBids[0].price * rhBids[0].size;
            const arbL1Cash = arbAsks[0].price * arbAsks[0].size;
            const maxEntryWall = Math.round(Math.min(rhL1Cash, arbL1Cash));
            let edgeSpreadPct = 0.05;
            if (rhBids[0].price > 0) {
                edgeSpreadPct = parseFloat((((arbAsks[0].price - rhBids[0].price) / rhBids[0].price) * 100).toFixed(3));
            }
            // Вход: продаем в rhBids, покупаем из arbAsks
            // Выход: покупаем из rhAsks, продаем в arbBids
            const sellSide = mode === 'open' ? rhBids : arbBids;
            const buySide = mode === 'open' ? arbAsks : rhAsks;
            const walk100 = simulateOrderbookWalk({
                targetNotional: sizing.notional100Pct,
                sellSideLevels: sellSide,
                buySideLevels: buySide,
            });
            const walk50 = simulateOrderbookWalk({
                targetNotional: sizing.notional50Pct,
                sellSideLevels: sellSide,
                buySideLevels: buySide,
            });
            let verdict = 'БИТЬ МАРКЕТОМ';
            if (walk100.lossPct > 0.15 || maxEntryWall < 2000) {
                verdict = 'ЛИМИТНИК POST-ONLY (Тонкий стакан)';
            }
            else if (hasBoost) {
                verdict = isNewListing ? 'БИТЬ МАРКЕТОМ (🔥 Буст листинга)' : 'БИТЬ МАРКЕТОМ (🔥 Буст отчетов)';
            }
            else if (oiRh < 800000) {
                verdict = 'БИТЬ МАРКЕТОМ (🟢 Low OI yield)';
            }
            rows.push({
                symbol: sym,
                type: assetType,
                isStock,
                earningsText,
                hasEarningsBoost: hasBoost,
                daysUntilEarnings: earnings.daysUntilEarnings,
                loss100Usd: walk100.lossUsd,
                loss100Pct: walk100.lossPct,
                loss50Usd: walk50.lossUsd,
                loss50Pct: walk50.lossPct,
                oiRobinhoodUsd: oiRh,
                oiArbitrumUsd: oiArb,
                wallRhL1,
                wallRhL2,
                wallArbL1,
                wallArbL2,
                maxEntryWallUsd: maxEntryWall,
                edgeSpreadPct,
                macroRisk: macro,
                verdict,
                isNewListing,
            });
        }));
    }
    // 4. Сортировка:
    // Приоритет: 🔥 Бусты (отчет / новый листинг) -> 📈 Акции (по мин loss100Pct и OI) -> 🌐 Другие пары
    const sortedRows = sortMarketMatrixRows(rows);
    // Для ТОП-5 карточек: сначала бусты и акции; если не хватает, добавляем другие
    const top5 = sortedRows.slice(0, 5);
    const topCardsText = formatTopCardsMessage({
        walletsSummary,
        sizing,
        topRows: top5,
        mode,
    });
    const fileContent = generateCanonicalMarkdownFile(sortedRows, sizing);
    return { topCardsText, fileContent };
}
export async function calculateActiveHedgesExitReport() {
    const config = loadConfig();
    const activeHedges = getActiveHedges(config);
    if (activeHedges.length === 0) {
        return {
            text: '❌ **Нет активных открытых позиций!**\nВсе связки в портфеле закрыты. Чтобы найти лучшие пары для входа, нажмите **📈 Анализ входа (/o)**.',
        };
    }
    const [rhBooksRes, arbBooksRes] = await Promise.allSettled([
        fetch('https://api.rh.lighter.xyz/api/v1/orderBookDetails', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000),
        }).then((r) => r.json()),
        fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000),
        }).then((r) => r.json()),
    ]);
    const rhMap = new Map();
    const arbMap = new Map();
    if (rhBooksRes.status === 'fulfilled' && rhBooksRes.value?.order_book_details) {
        for (const b of rhBooksRes.value.order_book_details) {
            const p = parseFloat(b.mark_price || '0') || (typeof b.last_trade_price === 'number' ? b.last_trade_price : 0) || 1;
            rhMap.set(b.symbol.toUpperCase(), { id: b.market_id, price: p });
        }
    }
    if (arbBooksRes.status === 'fulfilled' && arbBooksRes.value?.order_book_details) {
        for (const b of arbBooksRes.value.order_book_details) {
            const p = parseFloat(b.mark_price || '0') || (typeof b.last_trade_price === 'number' ? b.last_trade_price : 0) || 1;
            arbMap.set(b.symbol.toUpperCase(), { id: b.market_id, price: p });
        }
    }
    const lines = [
        `📉 **АНАЛИЗ ВЫХОДА ИЗ АКТИВНЫХ ПОЗИЦИЙ (/c)**`,
        `Точный расчёт маркет-закрытия по живым стаканам Lighter:`,
        `━━━━━━━━━━━━━━━━━━━━`,
    ];
    for (const h of activeHedges) {
        const sym = h.symbol.toUpperCase();
        const leg1 = h.legs[0];
        const leg2 = h.legs[1];
        const size = leg1?.size || leg2?.size || 10;
        const entryPrice = leg1?.entryPrice || leg2?.entryPrice || 100;
        const leverage = leg1?.leverage || 7;
        const legName = leg1?.name || 'Портфель';
        const rhInfo = rhMap.get(sym);
        const arbInfo = arbMap.get(sym);
        const markPrice = rhInfo?.price || arbInfo?.price || entryPrice;
        const totalNotional = Math.round(size * markPrice);
        const halfNotional = Math.round(totalNotional / 2);
        const halfSize = parseFloat((size / 2).toFixed(3));
        const rhLeg = h.legs?.find((l) => l.side === 'short') || h.legs?.[0];
        const arbLeg = h.legs?.find((l) => l.side === 'long') || h.legs?.[1];
        const rhEntry = rhLeg?.entryPrice || entryPrice;
        const arbEntry = arbLeg?.entryPrice || entryPrice;
        const rhSize = rhLeg?.size || size;
        const arbSize = arbLeg?.size || size;
        let loss100Usd = 12;
        let loss100Pct = 0.045;
        let loss50Usd = 6;
        let loss50Pct = 0.045;
        let rhAskPrice = markPrice;
        let arbBidPrice = markPrice;
        let rhPnl100 = 0;
        let arbPnl100 = 0;
        let netExit100 = 0;
        let rhPnl50 = 0;
        let arbPnl50 = 0;
        let netExit50 = 0;
        if (rhInfo?.id && arbInfo?.id) {
            const [rhOb, arbOb] = await Promise.all([
                fetchOrderBookOrders('rh', rhInfo.id, 50),
                fetchOrderBookOrders('arb', arbInfo.id, 50),
            ]);
            const rhAsks = rhOb.asks;
            const arbBids = arbOb.bids;
            if (rhAsks.length > 0 && arbBids.length > 0) {
                rhAskPrice = rhAsks[0].price;
                arbBidPrice = arbBids[0].price;
                const walk100 = simulateOrderbookWalk({
                    targetNotional: totalNotional,
                    sellSideLevels: arbBids,
                    buySideLevels: rhAsks,
                });
                loss100Usd = walk100.lossUsd;
                loss100Pct = walk100.lossPct;
                const walk50 = simulateOrderbookWalk({
                    targetNotional: halfNotional,
                    sellSideLevels: arbBids,
                    buySideLevels: rhAsks,
                });
                loss50Usd = walk50.lossUsd;
                loss50Pct = walk50.lossPct;
                rhPnl100 = parseFloat(((rhEntry - walk100.avgBuyPrice) * rhSize).toFixed(2));
                arbPnl100 = parseFloat(((walk100.avgSellPrice - arbEntry) * arbSize).toFixed(2));
                netExit100 = parseFloat((rhPnl100 + arbPnl100).toFixed(2));
                rhPnl50 = parseFloat(((rhEntry - walk50.avgBuyPrice) * (rhSize / 2)).toFixed(2));
                arbPnl50 = parseFloat(((walk50.avgSellPrice - arbEntry) * (arbSize / 2)).toFixed(2));
                netExit50 = parseFloat((rhPnl50 + arbPnl50).toFixed(2));
            }
        }
        const spreadExitPct = rhAskPrice > 0 ? parseFloat((((rhAskPrice - arbBidPrice) / rhAskPrice) * 100).toFixed(3)) : 0;
        const spread100Str = loss100Usd <= 0
            ? `+$${Math.abs(loss100Usd)} (+${Math.abs(loss100Pct)}%) 🟢 (Премия со спреда — Arb Bid выше RH Ask)`
            : `-$${loss100Usd} (-${loss100Pct}%) 🔻 (Трение стакана / спред)`;
        const spread50Str = loss50Usd <= 0
            ? `+$${Math.abs(loss50Usd)} (+${Math.abs(loss50Pct)}%) 🟢 (Премия со спреда)`
            : `-$${loss50Usd} (-${loss50Pct}%) 🔻 (Трение стакана / спред)`;
        const netExit100Str = netExit100 >= 0 ? `+$${netExit100}` : `-$${Math.abs(netExit100)}`;
        const netExit50Str = netExit50 >= 0 ? `+$${netExit50}` : `-$${Math.abs(netExit50)}`;
        const rhPnl100Str = rhPnl100 >= 0 ? `+$${rhPnl100}` : `-$${Math.abs(rhPnl100)}`;
        const arbPnl100Str = arbPnl100 >= 0 ? `+$${arbPnl100}` : `-$${Math.abs(arbPnl100)}`;
        const rhPnl50Str = rhPnl50 >= 0 ? `+$${rhPnl50}` : `-$${Math.abs(rhPnl50)}`;
        const arbPnl50Str = arbPnl50 >= 0 ? `+$${arbPnl50}` : `-$${Math.abs(arbPnl50)}`;
        lines.push(`📌 **$${sym}** (Активна на ${legName} | ${leverage}x плечо)`, `• Текущая позиция: **${size} ${sym}** (Номинал: **$${totalNotional}**)`, `• Вход: RH Short **$${rhEntry}** | Arb Long **$${arbEntry}**`, `• Стаканы выхода: RH Ask **$${rhAskPrice}** | Arb Bid **$${arbBidPrice}** (спред: ${spreadExitPct}%)`, ``, `🔻 **Полное закрытие (100%):**`, `• Закрываемый объем: **$${totalNotional}** (${size} ${sym})`, `• Спред выхода (стакан): **${spread100Str}**`, `• Ожидаемый Net PnL выхода: **${netExit100Str}** (RH ${rhPnl100Str}, Arb ${arbPnl100Str})`, ``, `🔻 **Половина позиции (50%):**`, `• Закрываемый объем: **$${halfNotional}** (${halfSize} ${sym})`, `• Спред выхода (стакан): **${spread50Str}**`, `• Ожидаемый Net PnL выхода: **${netExit50Str}** (RH ${rhPnl50Str}, Arb ${arbPnl50Str})`, `━━━━━━━━━━━━━━━━━━━━`);
    }
    const buttons = activeHedges.map((h) => [
        { text: `🛑 Закрыть ${h.symbol}`, callback_data: `close_${h.symbol}` },
    ]);
    return {
        text: lines.join('\n'),
        inlineKeyboard: { inline_keyboard: buttons },
    };
}
