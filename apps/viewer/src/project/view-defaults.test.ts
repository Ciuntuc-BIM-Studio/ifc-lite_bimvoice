/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Default project views: levels merged across federated models, one plan
 * per level plus four elevations and {3D}, and a sync that only ever adds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultViews, levelsFromStoreys, resolvePlanLevel, syncDefaultViews, uniqueViewName } from './view-defaults.js';
import type { PlanProjectView } from './types.js';

const storeys = [
  { name: 'Ground Floor', elevation: 0, globalId: 'A0' },
  { name: 'Level 1', elevation: 3.2, globalId: 'A1' },
  // Structural model repeats the levels with slightly different elevations.
  { name: 'EG', elevation: 0.05, globalId: 'S0' },
  { name: 'Level 1 (structure)', elevation: 3.15, globalId: 'S1' },
];

describe('levelsFromStoreys', () => {
  it('merges storeys at the same elevation across models, shortest name wins, top-down', () => {
    const levels = levelsFromStoreys(storeys);
    assert.deepEqual(levels.map((l) => l.name), ['Level 1', 'EG']);
    assert.deepEqual(levels[0].storeyGlobalIds, ['S1', 'A1']);
    assert.deepEqual(levels[1].storeyGlobalIds, ['A0', 'S0']);
  });

  it('returns no levels for no storeys', () => {
    assert.deepEqual(levelsFromStoreys([]), []);
  });
});

describe('defaultViews', () => {
  it('creates one plan per level, four elevations and a 3D view', () => {
    const views = defaultViews(levelsFromStoreys(storeys), 1);
    assert.deepEqual(views.map((v) => v.kind), ['plan', 'plan', 'elevation', 'elevation', 'elevation', 'elevation', '3d']);
    assert.deepEqual(views.filter((v) => v.kind === 'elevation').map((v) => v.name), ['North Elevation', 'East Elevation', 'South Elevation', 'West Elevation']);
    const plan = views[0] as PlanProjectView;
    assert.equal(plan.cutHeight, 1.2);
    assert.equal(plan.auto, true);
    assert.equal(new Set(views.map((v) => v.id)).size, views.length);
  });
});

describe('syncDefaultViews', () => {
  it('returns the same array when every level already has a plan', () => {
    const levels = levelsFromStoreys(storeys);
    const views = defaultViews(levels);
    assert.equal(syncDefaultViews(views, levels), views);
  });

  it('adds a plan for a new level and keeps plans whose level is gone', () => {
    const views = defaultViews(levelsFromStoreys(storeys.slice(0, 1)));
    const next = syncDefaultViews(views, levelsFromStoreys([{ name: 'Roof', elevation: 9, globalId: 'R' }]));
    const plans = next.filter((v) => v.kind === 'plan').map((v) => v.name);
    assert.deepEqual(plans, ['Ground Floor', 'Roof']);
  });

  it('matches a plan to its level by storey GlobalId even when the elevation moved', () => {
    const [plan] = defaultViews(levelsFromStoreys([{ name: 'L1', elevation: 3, globalId: 'G1' }])) as PlanProjectView[];
    const moved = levelsFromStoreys([{ name: 'L1', elevation: 3.6, globalId: 'G1' }]);
    assert.equal(resolvePlanLevel(plan, moved)?.elevation, 3.6);
  });
});

describe('uniqueViewName', () => {
  it('appends the first free counter, case-insensitively', () => {
    assert.equal(uniqueViewName('Section', [{ name: 'section' }, { name: 'Section (2)' }]), 'Section (3)');
    assert.equal(uniqueViewName('Section', []), 'Section');
  });
});
