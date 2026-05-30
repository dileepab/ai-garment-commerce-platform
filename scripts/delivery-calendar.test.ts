import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateSriLankaDeliveryWindow,
  formatSriLankaDateKey,
  isSriLankaNonWorkingDay,
} from '../src/lib/delivery-calendar.ts';

test('Sri Lanka delivery window starts after a holiday weekend', () => {
  const vesakSaturday = new Date(Date.UTC(2026, 4, 30));

  assert.equal(isSriLankaNonWorkingDay(vesakSaturday), true);

  const window = calculateSriLankaDeliveryWindow(vesakSaturday, [2, 3]);

  assert.equal(formatSriLankaDateKey(window.startDate), '2026-06-01');
  assert.equal(formatSriLankaDateKey(window.earliestDate), '2026-06-03');
  assert.equal(formatSriLankaDateKey(window.latestDate), '2026-06-04');
});

test('Sri Lanka delivery window keeps existing working-day behavior', () => {
  const monday = new Date(Date.UTC(2026, 5, 1));
  const window = calculateSriLankaDeliveryWindow(monday, [2, 3]);

  assert.equal(formatSriLankaDateKey(window.startDate), '2026-06-01');
  assert.equal(formatSriLankaDateKey(window.earliestDate), '2026-06-03');
  assert.equal(formatSriLankaDateKey(window.latestDate), '2026-06-04');
});
