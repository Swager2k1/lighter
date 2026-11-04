import test from 'node:test';
import assert from 'node:assert/strict';
import { getEarningsInfo, getReportingWeekInterval } from '../src/services/calendarService.js';

test('getReportingWeekInterval calculates Friday 00:00 to Thursday 23:59', () => {
  // 04.11.2026 (Среда)
  const d0411 = new Date(2026, 10, 4, 12, 0, 0);
  const week0411 = getReportingWeekInterval(d0411);
  assert.equal(week0411.start.getDate(), 30);
  assert.equal(week0411.start.getMonth(), 9); // Октябрь
  assert.equal(week0411.start.getDay(), 5); // Пятница
  assert.equal(week0411.end.getDate(), 5);
  assert.equal(week0411.end.getMonth(), 10); // Ноябрь
  assert.equal(week0411.end.getDay(), 4); // Четверг

  // 07.11.2026 (Суббота)
  const d0711 = new Date(2026, 10, 7, 15, 0, 0);
  const week0711 = getReportingWeekInterval(d0711);
  assert.equal(week0711.start.getDate(), 6);
  assert.equal(week0711.start.getMonth(), 10); // Ноябрь (Пятница 06.11)
  assert.equal(week0711.start.getDay(), 5);
  assert.equal(week0711.end.getDate(), 12);
  assert.equal(week0711.end.getMonth(), 10); // Четверг 12.11
  assert.equal(week0711.end.getDay(), 4);
});

test('getEarningsInfo grants boost only if report is in current Friday-Thursday week', () => {
  // На 04.11.2026: неделя 30.10 - 05.11
  // Отчет 06.11.2026 находится на СЛЕДУЮЩЕЙ неделе -> буста быть НЕ ДОЛЖНО!
  const d0411 = new Date(2026, 10, 4, 12, 0, 0);
  
  // Тестируем через передачу даты в getEarningsInfo
  // NVDA отчет 18.11.2026 -> на 04.11 он не в этой неделе
  const infoNvda = getEarningsInfo('NVDA', d0411);
  assert.equal(infoNvda.boost, false); // На этой неделе буста нет!

  // На 07.11.2026: неделя 06.11 - 12.11
  // Проверим вымышленный/будущий отчет в окне
  const d0711 = new Date(2026, 10, 7, 12, 0, 0);
  const week0711 = getReportingWeekInterval(d0711);
  const targetDate1211 = new Date(2026, 10, 12);
  assert.ok(targetDate1211 >= week0711.start && targetDate1211 <= week0711.end);
});

test('calendarService returns fallback for assets without earnings', () => {
  const info = getEarningsInfo('TSM');
  assert.equal(info.hasEarnings, false);
  assert.equal(info.boost, false);
  assert.equal(info.riskText, '🟢 Безопасно (нет отчета)');
});
