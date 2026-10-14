/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeRemeshPlan } from '@ifc-lite/create';
import { colourFromStyles } from './native-remesh.js';

const plan = (itemIds: number[]): NativeRemeshPlan => ({
  expressIds: itemIds.map(() => 7), ifcTypes: itemIds.map(() => 'IfcWindow'), buffer: new Float64Array(), itemIds,
  frames: new Float64Array(), layers: new Float64Array(), materialIds: [], fallback: new Map(),
});

it('a styled part takes its style; an unstyled one keeps the colour it was given', () => {
  // Three parts of one window: a frame box (white), a glass pane (translucent blue), one with no style.
  const colors = new Float32Array([0.6, 0.8, 1, 0.4, 0.6, 0.8, 1, 0.4, 0.6, 0.8, 1, 0.4]);
  colourFromStyles(plan([101, 102, 103]), colors, [Uint32Array.from([102, 101]), Uint8Array.from([155, 199, 232, 89, 242, 242, 242, 255])]);
  const at = (i: number) => Array.from(colors.subarray(i * 4, i * 4 + 4)).map((c) => +c.toFixed(2));
  assert.deepEqual(at(0), [0.95, 0.95, 0.95, 1]);
  assert.deepEqual(at(1), [0.61, 0.78, 0.91, 0.35]);
  assert.deepEqual(at(2), [0.6, 0.8, 1, 0.4]);
});
