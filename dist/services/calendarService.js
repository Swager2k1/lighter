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
/**
 * Расчет текущей отчетной недели:
 * Неделя начинается в Пятницу 00:00:00.000 и заканчивается в Четверг 23:59:59.999
 */
export function getReportingWeekInterval(referenceDate = new Date()) {
    const d = new Date(referenceDate);
    const day = d.getDay(); // 0=Вс, 1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт, 6=Сб
    // Сколько дней назад была пятница?
    // Вс (0) -> 2 дня назад (Пт)
    // Пн (1) -> 3 дня назад
    // Вт (2) -> 4 дня назад
    // Ср (3) -> 5 дней назад
    // Чт (4) -> 6 дней назад
    // Пт (5) -> 0 дней назад
    // Сб (6) -> 1 день назад
    const diffDays = (day + 2) % 7;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffDays, 0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
    return { start, end };
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
export function getEarningsInfo(symbol, referenceDate = new Date()) {
    const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
    const calendar = loadEarningsCalendar();
    const item = calendar.earnings[norm];
    if (item && item.boost) {
        const target = parseCalendarDate(item.date);
        let daysUntil = 999999;
        if (target) {
            const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
            const diffMs = target.getTime() - today.getTime();
            daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));
            // Проверка отчетной недели:
            // Буст активен ТОЛЬКО если дата отчета попадает в текущую отчетную неделю (Пятница - Четверг)
            // и отчет еще не состоялся (target >= today)
            const week = getReportingWeekInterval(referenceDate);
            const inCurrentWeek = target >= week.start && target <= week.end;
            if (daysUntil >= 0 && inCurrentWeek) {
                return {
                    hasEarnings: true,
                    boost: true,
                    date: item.date,
                    daysUntilEarnings: daysUntil,
                    riskText: `⚠️ Отчет ${item.date} (${item.risk})`,
                    displayColumn: `${item.date} 🔥 (через ${daysUntil}д | ${item.risk})`,
                };
            }
            else if (daysUntil >= 0) {
                return {
                    hasEarnings: true,
                    boost: false,
                    date: item.date,
                    daysUntilEarnings: daysUntil,
                    riskText: `ℹ️ Отчет ${item.date} (не на этой неделе | ${item.risk})`,
                    displayColumn: `${item.date} (через ${daysUntil}д | без буста)`,
                };
            }
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
