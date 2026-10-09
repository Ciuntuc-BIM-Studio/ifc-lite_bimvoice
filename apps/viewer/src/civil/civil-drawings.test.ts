/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Road drawings of a corridor in a loaded model: a longitudinal profile and
 * a section set as project documents, laid out in paper millimetres for a
 * sheet, and drawn on a plan's canvas as drafted entities (Civil 3D style).
 */

import '@/test/setup-dom.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addCorridorToStore, componentFromProfile, defaultAssembly, defaultDesign, profileFromPreset, resolveSpatialAnchor, type CorridorSpec } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { MODEL_ID, STOREY, seedModelingSession } from '@/test/modeling-session-fixture';
import { EMPTY_PROJECT, loadProjectDocument, useProjectStore } from '@/project/project-store';
import { allCorridors } from './corridor-element';
import { addCivilDrawing, buildCivilDrawing, drawingEntities, duplicateCivilDrawing, ensureCivilLayers, layoutCivilDrawing, updateCivilDrawing } from './civil-drawings';

const spec: CorridorSpec = {
  name: 'DN1', alignment: { pis: [{ x: 0, y: 0 }, { x: 120, y: 0, radius: 50 }, { x: 120, y: -100 }] },
  profile: { pvis: [{ station: 0, elevation: 1 }, { station: 90, elevation: 2, length: 30 }, { station: 190, elevation: 1.5 }] },
  assembly: defaultAssembly(), design: defaultDesign(), interval: 10,
  components: [componentFromProfile('w', profileFromPreset('cantilever-wall', 'p'), 20, 80)],
};

beforeEach(async () => {
  await seedModelingSession();
  loadProjectDocument({ ...EMPTY_PROJECT });
  recordModellingCommit(useViewerStore, MODEL_ID, (editor, ds) => addCorridorToStore(ds, editor, resolveSpatialAnchor(ds, STOREY, editor.getMutationView()), spec, null));
});

describe('road drawings', () => {
  it('a profile view: a document of the corridor, laid out on paper at its scale', () => {
    const [ref] = allCorridors();
    assert.ok(ref);
    const id = addCivilDrawing(ref, 'profile');
    const d = useProjectStore.getState().civilDrawings!.find((x) => x.id === id)!;
    assert.equal(d.name, 'DN1 — longitudinal profile');
    const built = buildCivilDrawing(d);
    assert.ok('prims' in built);
    const layout = layoutCivilDrawing(built, d.scale);
    // 1 : 1000 horizontally: about 190 m of road is about 190 mm, plus the band's label column.
    assert.ok(layout.width > 190 && layout.width < 240, String(layout.width));
    assert.ok(layout.prims.some((p) => p.kind === 'path' && p.pen.layer === 'C-ROAD-DESIGN'));
    assert.ok(layout.prims.some((p) => p.kind === 'text' && p.text === 'R = 50.0'));
    updateCivilDrawing(id, { scale: 500 });
    const bigger = buildCivilDrawing(useProjectStore.getState().civilDrawings!.find((x) => x.id === id)!);
    assert.ok('prims' in bigger && layoutCivilDrawing(bigger, 500).width > layout.width * 1.8);
    assert.ok(duplicateCivilDrawing(id));
    assert.equal(useProjectStore.getState().civilDrawings!.length, 2);
  });

  it('a section set, drawn on a plan as drafted entities on the road layers, upright on a y-down plan', () => {
    const [ref] = allCorridors();
    const id = addCivilDrawing(ref!, 'sections');
    const d = useProjectStore.getState().civilDrawings!.find((x) => x.id === id)!;
    const built = buildCivilDrawing(d, 100);
    assert.ok('prims' in built);
    ensureCivilLayers();
    assert.ok(useProjectStore.getState().draftLayers.some((l) => l.name === 'C-ROAD-DESIGN'));
    const up = drawingEntities(d, built, 'plan-1', { x: 100, y: 50 }, 100, 1);
    const down = drawingEntities(d, built, 'plan-1', { x: 100, y: 50 }, 100, -1);
    assert.equal(up.length, down.length);
    assert.ok(up.every((e) => e.viewId === 'plan-1' && e.params.civilDrawing === id));
    assert.ok(up.some((e) => e.shape.type === 'hatch'), 'the courses are filled');
    const texts = up.filter((e) => e.shape.type === 'text');
    // Text prints 2 mm high at 1 : 100: 0.2 m.
    assert.ok(texts.some((e) => e.shape.type === 'text' && Math.abs(e.shape.height - 0.2) < 1e-9));
    const ys = (list: typeof up) => list.flatMap((e) => (e.shape.type === 'line' ? [e.shape.a.y, e.shape.b.y] : []));
    assert.ok(Math.min(...ys(up)) >= 50 - 1e-9, 'y-up: the drawing grows up from the picked point');
    assert.ok(Math.max(...ys(down)) <= 50 + 1e-9, 'y-down plan: it grows down in drawing terms, up on screen');
  });

  it('a drawing whose corridor is gone says so', () => {
    const [ref] = allCorridors();
    const id = addCivilDrawing(ref!, 'profile');
    updateCivilDrawing(id, { corridorGlobalId: 'nope' } as never);
    const built = buildCivilDrawing(useProjectStore.getState().civilDrawings!.find((x) => x.id === id)!);
    assert.ok('error' in built);
  });
});
