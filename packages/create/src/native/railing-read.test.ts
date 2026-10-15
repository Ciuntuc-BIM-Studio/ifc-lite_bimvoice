/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A railing the railing builder wrote is a native system: lifted with the
 * builder's own parameters (read from its body), in the session and from the
 * IFC read back, so building it again from them gives the same railing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { addRailingToStore, type RailingInStoreParams } from '../in-store/railing.js';
import { resolveSpatialAnchor } from '../in-store/resolve-anchor.js';
import { liftNativeModel } from './lift.js';

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
const MODEL = { id: '00000000-0000-4000-8000-000000000000', name: '' };

const RAILINGS: Record<string, RailingInStoreParams> = {
  straight: { Path: [[0, 30, 0], [5, 30, 0]], Height: 1.1 },
  spaced: { Path: [[0, 32, 0], [4.5, 32, 0], [4.5, 35, 0]], Height: 1, RailDiameter: 0.06, PostDiameter: 0.04, PostSpacing: 1.2 },
  sloped: { Path: [[10, 30, 0], [13, 30, 1.8], [13, 31.2, 1.8]], Height: 0.9, PostSpacing: 0.8, PredefinedType: 'GUARDRAIL' },
};

function liftRailings(store: IfcDataStore, view: MutablePropertyView, ids: Map<string, number>) {
  const lifted = liftNativeModel(store, view, MODEL);
  const out = new Map<string, unknown>();
  for (const [key, id] of ids) {
    const e = lifted.model.elements.find((x) => lifted.expressIds.get(x.id) === id);
    expect(e, `${key}: ${JSON.stringify(lifted.skipped.filter((s) => s.expressId === id))}`).toMatchObject({ kind: 'system', family: 'railing' });
    out.set(key, e && e.kind === 'system' ? e.spec : null);
  }
  return out;
}

describe('railings as native systems', () => {
  it('are lifted with the builder\'s parameters, in the session and from the IFC read back', async () => {
    const store = await parse(readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url)));
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const anchor = resolveSpatialAnchor(store, [...store.spatialHierarchy!.storeyElevations.keys()][0], view);
    const ids = new Map(Object.entries(RAILINGS).map(([key, params]) => [key, addRailingToStore(editor, anchor, params).railingId]));

    const expected = (p: RailingInStoreParams) => ({
      Path: p.Path, Height: p.Height, RailDiameter: p.RailDiameter ?? 0.05,
      ...(p.PostDiameter !== undefined ? { PostDiameter: p.PostDiameter } : {}),
      ...(p.PredefinedType ? { PredefinedType: p.PredefinedType } : { PredefinedType: 'HANDRAIL' }),
    });
    const session = liftRailings(store, view, ids);
    for (const [key, params] of Object.entries(RAILINGS)) {
      const spec = session.get(key) as RailingInStoreParams;
      expect(spec, key).toMatchObject(expected(params));
      // The spacing read back may be smaller than the one given, never with other posts.
      if (params.PostSpacing === undefined) expect(spec.PostSpacing, key).toBeUndefined();
      else expect(spec.PostSpacing, key).toBeLessThanOrEqual(params.PostSpacing + 1e-9);
    }

    // Built again from what was read: the same railing, read the same.
    const again = new Map([...session].map(([key, spec]) => [key, addRailingToStore(editor, anchor, spec as RailingInStoreParams).railingId]));
    expect(liftRailings(store, view, again)).toEqual(session);

    const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content as Uint8Array;
    expect(liftRailings(await parse(bytes), new MutablePropertyView(null, 'r'), ids)).toEqual(session);
  });
});
