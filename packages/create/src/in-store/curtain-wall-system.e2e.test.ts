/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A parametric curtain wall written into a real model: its spec kept and read back
 * (also after export), regenerated in place keeping the parts that are still laid
 * out, and an older curtain wall (no spec) read back from its parts. */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IfcDataStore } from '@ifc-lite/parser';

let IfcParser: typeof import('@ifc-lite/parser').IfcParser;
let MutablePropertyView: typeof import('@ifc-lite/mutations').MutablePropertyView;
let StoreEditor: typeof import('@ifc-lite/mutations').StoreEditor;
let StepExporter: typeof import('@ifc-lite/export').StepExporter;
let resolveSpatialAnchor: typeof import('./resolve-anchor.js').resolveSpatialAnchor;
let cw: typeof import('./curtain-wall-system.js') & typeof import('./curtain-wall-infer.js');
let builder: typeof import('./curtain-wall.js');

const parse = (bytes: Uint8Array): Promise<IfcDataStore> => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  { disableWorkerScan: true },
);

async function model() {
  const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
  const store = await parse(source);
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const storeyId = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
  return { store, view, editor, anchor: resolveSpatialAnchor(store, storeyId, view) };
}

describe('parametric curtain wall', () => {
  beforeAll(async () => {
    ({ IfcParser } = await import('@ifc-lite/parser'));
    ({ MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations'));
    ({ StepExporter } = await import('@ifc-lite/export'));
    ({ resolveSpatialAnchor } = await import('./resolve-anchor.js'));
    cw = { ...(await import('./curtain-wall-system.js')), ...(await import('./curtain-wall-infer.js')) };
    builder = await import('./curtain-wall.js');
  }, 60_000);

  const spec = (u: import('./curtain-wall-system.js').CurtainGridRule) => ({
    ...cw.DEFAULT_CURTAIN_WALL_TYPE, version: 1 as const, name: 'CW', start: [0, 0, 0] as [number, number, number], end: [6, 0, 0] as [number, number, number], height: 3, u, v: { mode: 'count' as const, count: 2 },
  });

  it('resolves grid rules to bays or offsets', () => {
    expect(cw.resolveGrid({ mode: 'count', count: 4 }, 6)).toBe(4);
    expect(cw.resolveGrid({ mode: 'max', spacing: 1.5 }, 6.1)).toBe(5);
    expect(cw.resolveGrid({ mode: 'spacing', spacing: 2, justify: 'start' }, 5)).toEqual([1, 3]);
    expect(cw.resolveGrid({ mode: 'spacing', spacing: 2, justify: 'center' }, 5)).toEqual([0.5, 2.5, 4.5]);
    expect(cw.resolveGrid({ mode: 'offsets', offsets: [4, 1, 1, 9] }, 6)).toEqual([1, 4]);
  });

  it('keeps its spec, regenerates in place keeping the parts still laid out', async () => {
    const { store, view, editor, anchor } = await model();
    const made = cw.addCurtainWallSystemToStore(editor, anchor, spec({ mode: 'count', count: 3 }));
    expect(cw.readCurtainWallSystem(store, made.curtainWallId, view)?.u).toEqual({ mode: 'count', count: 3 });
    expect(cw.curtainWallOf(store, made.parts[0], view)).toBe(made.curtainWallId);
    const tag = (id: number) => String(view.getNewEntity(id)?.attributes[7] ?? '');
    const panel = made.parts.find((id) => tag(id) === 'panel:0:0')!;
    const panelGuid = view.getNewEntity(panel)!.attributes[0];
    expect(made.parts.filter((id) => tag(id).startsWith('panel:'))).toHaveLength(6);

    // Four bays: the first panels stay (same entity, same GlobalId), the new bay's are added.
    const again = cw.regenerateCurtainWallInStore(store, editor, anchor, made.curtainWallId, spec({ mode: 'count', count: 4 }));
    expect(again.parts).toContain(panel);
    expect(view.getNewEntity(panel)!.attributes[0]).toBe(panelGuid);
    expect(again.parts.filter((id) => tag(id).startsWith('panel:'))).toHaveLength(8);
    // Two bays: the extra ones go.
    const fewer = cw.regenerateCurtainWallInStore(store, editor, anchor, made.curtainWallId, spec({ mode: 'count', count: 2 }));
    expect(fewer.parts.filter((id) => tag(id).startsWith('panel:'))).toHaveLength(4);
    expect(fewer.removed.length).toBeGreaterThan(0);

    const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("'Pset_IfcLiteCurtainWall'");
    expect(text).toContain(`'${panelGuid}'`);
    const reparsed = await parse(bytes);
    expect(cw.readCurtainWallSystem(reparsed, made.curtainWallId)?.u).toEqual({ mode: 'count', count: 2 });
    expect(cw.curtainWallParts(reparsed, made.curtainWallId)).toHaveLength(fewer.parts.length);
  });

  it('reads an older curtain wall (no spec) back from its parts, then keeps a spec', async () => {
    const { store, view, editor, anchor } = await model();
    const old = builder.addCurtainWallToStore(editor, anchor, {
      Start: [1, 2, 0], End: [1, 8, 0], Height: 3.2, UGrid: [2, 3.5], VGrid: 2,
      MullionProfile: { Type: 'Rectangle', XDim: 0.06, YDim: 0.2 }, PanelThickness: 0.03,
    });
    expect(cw.readCurtainWallSystem(store, old.curtainWallId, view)).toBeNull();
    const read = cw.inferCurtainWallSpec(store, anchor, old.curtainWallId, view)!;
    expect(read.start).toEqual([1, 2, 0]);
    expect(read.end[1]).toBeCloseTo(8, 6);
    expect(read.height).toBeCloseTo(3.2, 6);
    expect(read.u).toEqual({ mode: 'offsets', offsets: [2, 3.5] });
    expect(read.v).toEqual({ mode: 'count', count: 2 });
    expect(read.mullion.width).toBeCloseTo(0.06, 6);
    expect(read.mullion.depth).toBeCloseTo(0.2, 6);
    expect(read.panel.thickness).toBeCloseTo(0.03, 6);
    expect(read.edge).toBe(true);
    cw.regenerateCurtainWallInStore(store, editor, anchor, old.curtainWallId, read);
    expect(cw.readCurtainWallSystem(store, old.curtainWallId, view)?.height).toBeCloseTo(3.2, 6);
  });
});
