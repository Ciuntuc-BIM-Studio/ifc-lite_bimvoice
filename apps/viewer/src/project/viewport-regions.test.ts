/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetProject, useProjectStore } from './project-store.js';
import { editDrafts, newDraft } from '@/drafting/draft-store';
import { findRegion, isViewportRegion, nextRegionName, renameRegion, viewportLayerId, viewportRegions, VIEWPORT_LAYER_NAME } from './viewport-regions.js';

beforeEach(() => resetProject());

const square = { type: 'polyline' as const, pts: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], closed: true };

describe('viewport regions', () => {
  it('are closed polylines marked as regions, on their own Viewports layer', () => {
    const layer = viewportLayerId();
    assert.equal(viewportLayerId(), layer, 'the layer is made once');
    assert.equal(useProjectStore.getState().draftLayers.find((l) => l.id === layer)?.name, VIEWPORT_LAYER_NAME);
    const [id] = editDrafts({ add: [
      newDraft('plan-1', layer, square, { viewportRegion: true, viewportName: 'Zona A' }),
      newDraft('plan-1', '0', square),
      newDraft('plan-1', layer, { ...square, closed: false }, { viewportRegion: true }),
    ] });
    const regions = viewportRegions('plan-1', useProjectStore.getState().drafts);
    assert.deepEqual(regions.map((r) => r.name), ['Zona A'], 'a plain polyline or an open one is no region');
    assert.equal(findRegion(id)?.viewId, 'plan-1');
    assert.equal(isViewportRegion(useProjectStore.getState().drafts[1]), false);
  });

  it('names new regions in turn and renames them', () => {
    const layer = viewportLayerId();
    assert.equal(nextRegionName('plan-1'), 'Viewport 1');
    const [id] = editDrafts({ add: [newDraft('plan-1', layer, square, { viewportRegion: true, viewportName: 'Viewport 1' })] });
    assert.equal(nextRegionName('plan-1'), 'Viewport 2');
    renameRegion(id, 'Detaliu streașină');
    assert.equal(findRegion(id)?.name, 'Detaliu streașină');
  });
});
