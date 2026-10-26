export function getMmrForVenue(venue, maxLeverage = 10) {
    if (venue === 'lighter') {
        return 0.06; // 6.0% зафиксировано в смарт-контракте Lighter
    }
    // Официальная формула Polymarket: 0.5 / MaxLeverage
    return 0.5 / maxLeverage;
}
export function calculateLiquidationPrice(entryPrice, leverage, side, venue) {
    if (entryPrice <= 0 || leverage <= 0)
        return 0;
    const mmr = getMmrForVenue(venue);
    if (side === 'long') {
        // Лонг ликвидируется при падении
        const liqPrice = entryPrice * (1 - 1 / leverage + mmr);
        return Math.max(0, parseFloat(liqPrice.toFixed(2)));
    }
    else {
        // Шорт ликвидируется при росте
        const liqPrice = entryPrice * (1 + 1 / leverage - mmr);
        return parseFloat(liqPrice.toFixed(2));
    }
}
export function evaluateLegRisk(leg, currentPrice, warningThresholdPct = 5.0, criticalThresholdPct = 2.5) {
    const liqPrice = leg.liquidationPrice || calculateLiquidationPrice(leg.entryPrice, leg.leverage, leg.side, leg.venue);
    let distancePct = 0;
    let distanceUsd = 0;
    let pnl = 0;
    if (leg.side === 'long') {
        distancePct = currentPrice > 0 ? ((currentPrice - liqPrice) / currentPrice) * 100 : 0;
        distanceUsd = currentPrice - liqPrice;
        pnl = leg.size * (currentPrice - leg.entryPrice);
    }
    else {
        distancePct = currentPrice > 0 ? ((liqPrice - currentPrice) / currentPrice) * 100 : 0;
        distanceUsd = liqPrice - currentPrice;
        pnl = leg.size * (leg.entryPrice - currentPrice);
    }
    let status = 'safe';
    if (distancePct <= criticalThresholdPct) {
        status = 'critical';
    }
    else if (distancePct <= warningThresholdPct) {
        status = 'warning';
    }
    return {
        legId: leg.id,
        name: leg.name,
        venue: leg.venue,
        side: leg.side,
        margin: leg.margin,
        entryPrice: leg.entryPrice,
        currentPrice,
        liquidationPrice: liqPrice,
        distanceToLiqPct: parseFloat(distancePct.toFixed(2)),
        distanceToLiqUsd: parseFloat(distanceUsd.toFixed(2)),
        unrealizedPnl: parseFloat(pnl.toFixed(2)),
        status,
        leverage: leg.leverage,
        size: leg.size,
    };
}
export function evaluateHedgeRisk(hedge, prices, warningThresholdPct = 5.0, criticalThresholdPct = 2.5) {
    const assessments = hedge.legs.map((leg) => {
        const curPrice = leg.venue === 'lighter' ? prices.lighterPrice : prices.polymarketPrice;
        return evaluateLegRisk(leg, curPrice, warningThresholdPct, criticalThresholdPct);
    });
    let totalMargin = 0;
    let notionalLong = 0;
    let notionalShort = 0;
    let totalPnl = 0;
    for (const leg of hedge.legs) {
        totalMargin += leg.margin;
        const notional = leg.margin * leg.leverage;
        if (leg.side === 'long') {
            notionalLong += notional;
        }
        else {
            notionalShort += notional;
        }
    }
    for (const a of assessments) {
        totalPnl += a.unrealizedPnl;
    }
    // Сортировка по минимальному запасу хода (самая опасная нога первая)
    const sorted = [...assessments].sort((a, b) => a.distanceToLiqPct - b.distanceToLiqPct);
    return {
        symbol: hedge.symbol,
        legs: assessments,
        totalMargin,
        totalNotionalLong: notionalLong,
        totalNotionalShort: notionalShort,
        netDeltaUsd: parseFloat((notionalLong - notionalShort).toFixed(2)),
        totalUnrealizedPnl: parseFloat(totalPnl.toFixed(2)),
        lowestBufferLeg: sorted[0],
        timestamp: Date.now(),
    };
}
