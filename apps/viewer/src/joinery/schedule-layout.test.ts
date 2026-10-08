/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDoorSpec, defaultWindowSpec } from '@ifc-lite/create';
import { layoutSchedule, scheduleCsv, type ScheduleLabels } from './schedule-layout';
import type { ScheduleData, ScheduleEntry } from './schedule-data';

const labels: ScheduleLabels = {
  title: 'Joinery', mark: 'Mark', name: 'Name', size: 'Size', operation: 'Opening', sill: 'Sill', total: 'Total', uValue: 'U', fire: 'Fire',
  op: (op) => op,
};

const entry = (over: Partial<ScheduleEntry>): ScheduleEntry => ({
  key: 'k', kind: 'window', spec: defaultWindowSpec('W'), mark: 'W1', name: 'W', width: 1.2, height: 1.5, counts: {}, total: 0, ...over,
});

const data: ScheduleData = {
  levels: ['Ground', 'Level 1'],
  entries: [
    entry({ key: 'w1', mark: 'W1', counts: { Ground: 3, 'Level 1': 2 }, total: 5 }),
    entry({ key: 'd1', kind: 'door', spec: defaultDoorSpec('D'), mark: 'D1', name: 'D', width: 0.9, height: 2.1, counts: { Ground: 1 }, total: 1 }),
    entry({ key: 'x', kind: 'door', spec: null, mark: '—', name: 'Door', width: 0.8, height: 2, counts: { 'Level 1': 4 }, total: 4 }),
  ],
};

const texts = (l: ReturnType<typeof layoutSchedule>) => l.prims.flatMap((p) => (p.kind === 'text' ? [p.text] : []));

describe('joinery schedule layout', () => {
  it('writes a card per type: mark, drawing dimensions, counts per level and total', () => {
    const layout = layoutSchedule(data, labels);
    const t = texts(layout);
    for (const s of ['Joinery', 'W1', 'D1', '1200', '1500', '900', '2100', 'Ground', 'Level 1', '3', '2', '5', '4', 'tilt-turn-left + side-right']) {
      assert.ok(t.includes(s), `missing ${s}`);
    }
    // The configured types draw their elevations; the untyped door a plain outline.
    assert.ok(layout.prims.filter((p) => p.kind === 'path').length > 10);
    assert.ok(layout.width > 34 + 3 * 30 - 1);
  });

  it('draws at the schedule scale and wraps cards into bands', () => {
    const at50 = layoutSchedule(data, labels, { scale: 50 });
    const at20 = layoutSchedule(data, labels, { scale: 20 });
    assert.ok(at20.width > at50.width);
    const narrow = layoutSchedule(data, labels, { scale: 50, maxWidth: 120 });
    assert.ok(narrow.height > at50.height * 1.5);
    assert.ok(narrow.width <= 120 || narrow.width < at50.width);
  });

  it('exports CSV with a column per level', () => {
    const csv = scheduleCsv(data, labels).trim().split('\n');
    assert.equal(csv[0], 'Mark,Name,Width (mm),Height (mm),Opening,Sill,Ground,Level 1,Total,U,Fire');
    assert.equal(csv[1], 'W1,W,1200,1500,tilt-turn-left + side-right,900,3,2,5,1.1,');
    assert.equal(csv[3].split(',')[0], '—');
  });
});
