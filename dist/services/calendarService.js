import fs from 'node:fs';
import path from 'node:path';
export function parseCalendarDate(dStr) {
    const parts = dStr.split('.');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        return new Date(year, month, day);
    }
    return null;
}
export function loadEarningsCalendar() {
    const calendarPath = path.resolve(process.cwd(), 'earnings_calendar.json');
    try {
        if (fs.existsSync(calendarPath)) {
            const raw = fs.readFileSync(calendarPath, 'utf-8');
            return JSON.parse(raw);
        }
    }
    catch (err) {
        console.error('[CalendarService] Ошибка чтения earnings_calendar.json:', err);
    }
    return {
        updatedAt: new Date().toISOString(),
        currentFarmWeek: 'Auto-fallback',
        earnings: {},
    };
}
export function getEarningsInfo(symbol) {
    const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
    const calendar = loadEarningsCalendar();
    const item = calendar.earnings[norm];
    if (item && item.boost) {
        const target = parseCalendarDate(item.date);
        let daysUntil = 999999;
        if (target) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const diffMs = target.getTime() - today.getTime();
            daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));
        }
        if (daysUntil >= 0) {
            return {
                hasEarnings: true,
                boost: true,
                date: item.date,
                daysUntilEarnings: daysUntil,
                riskText: `⚠️ Отчет ${item.date} (${item.risk})`,
                displayColumn: `${item.date} 🔥 (через ${daysUntil}д | ${item.risk})`,
            };
        }
    }
    return {
        hasEarnings: false,
        boost: false,
        date: item?.date || '—',
        daysUntilEarnings: 999999,
        riskText: '🟢 Безопасно (нет отчета)',
        displayColumn: item && !item.boost ? `— (${item.risk} 🟢)` : '— (Без отчета 🟢)',
    };
}
