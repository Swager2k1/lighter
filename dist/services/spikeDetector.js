export class SpikeDetector {
    ticks = new Map();
    maxWindowMs = 5 * 60 * 1000; // 5 минут
    lastAlertTimestamp = new Map();
    alertCooldownMs = 3 * 60 * 1000; // 3 минуты кулдауна между схожими алертоми
    addTick(symbol, price, thresholds = { spike1mPct: 1.0, spike3mPct: 1.8, spike5mPct: 2.5 }, now = Date.now()) {
        if (price <= 0)
            return null;
        let list = this.ticks.get(symbol);
        if (!list) {
            list = [];
            this.ticks.set(symbol, list);
        }
        list.push({ price, timestamp: now });
        // Очистка тиков старше 5 минут
        const cutoff = now - this.maxWindowMs;
        list = list.filter((t) => t.timestamp >= cutoff);
        this.ticks.set(symbol, list);
        if (list.length < 2)
            return null;
        // Проверка кулдауна
        const lastAlert = this.lastAlertTimestamp.get(symbol) || 0;
        if (now - lastAlert < this.alertCooldownMs) {
            return null;
        }
        // Проверяем 1m, 3m, 5m
        const windows = [
            { minutes: 1, ms: 60 * 1000, threshold: thresholds.spike1mPct },
            { minutes: 3, ms: 180 * 1000, threshold: thresholds.spike3mPct },
            { minutes: 5, ms: 300 * 1000, threshold: thresholds.spike5mPct },
        ];
        for (const w of windows) {
            const targetTime = now - w.ms;
            // Находим ближайший тик на или до targetTime
            const pastTick = list.find((t) => t.timestamp >= targetTime);
            if (pastTick && pastTick.price > 0) {
                const changePct = ((price - pastTick.price) / pastTick.price) * 100;
                const absChange = Math.abs(changePct);
                if (absChange >= w.threshold) {
                    this.lastAlertTimestamp.set(symbol, now);
                    return {
                        symbol,
                        startPrice: pastTick.price,
                        currentPrice: price,
                        changePct: parseFloat(changePct.toFixed(2)),
                        windowMinutes: w.minutes,
                        timestamp: now,
                    };
                }
            }
        }
        return null;
    }
    reset(symbol) {
        if (symbol) {
            this.ticks.delete(symbol);
            this.lastAlertTimestamp.delete(symbol);
        }
        else {
            this.ticks.clear();
            this.lastAlertTimestamp.clear();
        }
    }
}
export const globalSpikeDetector = new SpikeDetector();
