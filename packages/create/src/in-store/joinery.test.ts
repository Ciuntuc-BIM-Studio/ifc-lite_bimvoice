/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { MutablePropertyView, StoreEditor, type MutationEntityRef, type MutationStoreShape } from '@ifc-lite/mutations';
import { defaultDoorSpec, defaultWindowSpec, gridExtents, joineryProblem, normalisedPanels, panelRect, type JoinerySpec } from './joinery-spec.js';
import { doorOperation, liningOffsets, panelPosition, windowPartitioning } from './joinery-ifc.js';
import { joineryBoxes } from './joinery-geometry.js';
import { addJoineryTypeToStore, emitMappedBody, replaceJoineryTypeInStore } from './joinery-type.js';

function synthetic() {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= 20; id++) byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  const store: MutationStoreShape = { entityIndex: { byId } };
  const view = new MutablePropertyView(null, 'm');
  return { view, editor: new StoreEditor(store, view), anchor: { ownerHistoryId: 1, schema: 'IFC4' as const, bodyContextId: 5 } };
}

const window2x2 = (): JoinerySpec => ({
  ...defaultWindowSpec('W-2'), width: 1.6, height: 2,
  columns: [1, 1], rows: [3, 1],
  panels: [
    { col: 0, row: 0, operation: 'tilt-turn-left' },
    { col: 1, row: 0, operation: 'side-right' },
    { col: 0, row: 1, colSpan: 2, operation: 'bottom-hung' },
  ],
});

describe('joinery spec', () => {
  it('splits the inside of the frame between columns and rows, bars excluded', () => {
    const spec = window2x2();
    const { cols, rows } = gridExtents(spec);
    const f = spec.frame;
    expect(cols[0][0]).toBeCloseTo(-0.8 + f.width);
    expect(cols[1][1]).toBeCloseTo(0.8 - f.width);
    expect(cols[1][0] - cols[0][1]).toBeCloseTo(f.mullion);
    const inside = 2 - 2 * f.width - f.transom;
    expect(rows[0][1] - rows[0][0]).toBeCloseTo(inside * 0.75);
    // The top panel spans both columns and the mullion between them.
    const top = panelRect(spec, spec.panels[2]);
    expect(top.x0).toBeCloseTo(cols[0][0]);
    expect(top.x1).toBeCloseTo(cols[1][1]);
  });

  it('fills cells no panel covers with fixed glazing and drops overlapping panels', () => {
    const spec: JoinerySpec = { ...defaultWindowSpec(), columns: [1, 1, 1], panels: [{ col: 0, row: 0, colSpan: 2, operation: 'side-left' }, { col: 1, row: 0, operation: 'side-right' }] };
    const panels = normalisedPanels(spec);
    expect(panels.map((p) => [p.col, p.operation])).toEqual([[0, 'side-left'], [2, 'fixed']]);
  });

  it('refuses specs that cannot be built', () => {
    expect(joineryProblem(defaultWindowSpec())).toBeNull();
    expect(joineryProblem({ ...defaultWindowSpec(), width: 0 })).toMatch(/positive/);
    expect(joineryProblem({ ...defaultWindowSpec(), width: 0.3 })).not.toBeNull();
  });
});

describe('joinery in IFC terms', () => {
  it('names the window partitioning from the grid', () => {
    expect(windowPartitioning({ ...defaultWindowSpec(), columns: [1], panels: [] }).type).toBe('SINGLE_PANEL');
    expect(windowPartitioning(defaultWindowSpec()).type).toBe('DOUBLE_PANEL_VERTICAL');
    expect(windowPartitioning(window2x2()).type).toBe('TRIPLE_PANEL_TOP');
    expect(windowPartitioning({ ...defaultWindowSpec(), columns: [1, 1, 1, 1] })).toEqual({ type: 'USERDEFINED', userDefined: '4x1 grid, 4 panels' });
  });

  it('names the door operation from its leaves', () => {
    expect(doorOperation(defaultDoorSpec()).type).toBe('SINGLE_SWING_LEFT');
    const double: JoinerySpec = { ...defaultDoorSpec(), width: 1.6, columns: [1, 1], panels: [{ col: 0, row: 0, operation: 'swing-left' }, { col: 1, row: 0, operation: 'swing-right' }] };
    expect(doorOperation(double).type).toBe('DOUBLE_DOOR_SINGLE_SWING');
    const sidelight: JoinerySpec = { ...defaultDoorSpec(), width: 1.3, columns: [2, 1], panels: [{ col: 0, row: 0, operation: 'swing-right' }] };
    expect(doorOperation(sidelight).type).toBe('SWING_FIXED_RIGHT');
  });

  it('positions panels and expresses mullions as ratios', () => {
    const spec = window2x2();
    expect(normalisedPanels(spec).map((p) => panelPosition(spec, p, 'window'))).toEqual(['LEFT', 'RIGHT', 'MIDDLE']);
    const { mullions, transoms } = liningOffsets(defaultWindowSpec());
    expect(mullions).toHaveLength(1);
    expect(mullions[0]).toBeCloseTo(0.5);
    expect(transoms).toEqual([]);
  });
});

describe('joinery geometry', () => {
  it('stays inside the overall size and puts a handle opposite the hinges', () => {
    const spec = defaultWindowSpec();
    const boxes = joineryBoxes(spec);
    const body = boxes.filter((b) => b.role !== 'board' && b.role !== 'handle');
    for (const b of body) {
      expect(b.min[0]).toBeGreaterThanOrEqual(-spec.width / 2 - 1e-9);
      expect(b.max[0]).toBeLessThanOrEqual(spec.width / 2 + 1e-9);
      expect(b.min[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(b.max[2]).toBeLessThanOrEqual(spec.height + 1e-9);
    }
    const handles = boxes.filter((b) => b.role === 'handle');
    expect(handles).toHaveLength(2);
    // Left-hinged left sash: handle on its right; right-hinged right sash: on its left — both near the mullion.
    for (const h of handles) expect(Math.abs((h.min[0] + h.max[0]) / 2)).toBeLessThan(0.2);
    // Handles on the interior (−Y) side of the sash.
    for (const h of handles) expect(h.max[1]).toBeLessThanOrEqual(spec.frame.offset - spec.sash.depth / 2 + 1e-9);
    expect(boxes.filter((b) => b.role === 'glass')).toHaveLength(2);
  });

  it('does not run a mullion through a panel that spans across it', () => {
    const spec = window2x2();
    const { cols, rows } = gridExtents(spec);
    const mullionX = (cols[0][1] + cols[1][0]) / 2;
    const frames = joineryBoxes(spec).filter((b) => b.role === 'frame' && b.min[0] < mullionX && b.max[0] > mullionX && b.max[0] - b.min[0] < 0.2);
    // One mullion in the bottom row and the crossing — none in the top row.
    expect(frames.every((b) => b.max[2] <= rows[0][1] + spec.frame.transom + 1e-9)).toBe(true);
  });

  it('gives a door a threshold and a solid leaf', () => {
    const spec = defaultDoorSpec();
    const boxes = joineryBoxes(spec);
    expect(boxes.filter((b) => b.role === 'leaf')).toHaveLength(1);
    const bottom = boxes.find((b) => b.role === 'frame' && b.min[2] === 0 && b.max[2] < 0.05 && b.max[0] - b.min[0] > 0.5);
    expect(bottom?.max[2]).toBeCloseTo(spec.threshold);
  });
});

describe('joinery type in a store', () => {
  it('writes an IfcWindowType with lining, panel and common property sets and a representation map', () => {
    const { view, editor, anchor } = synthetic();
    const spec = window2x2();
    const made = addJoineryTypeToStore(editor, anchor, spec);
    const type = view.getNewEntity(made.typeId)!;
    expect(type.type).toBe('IfcWindowType');
    const attrs = type.attributes as unknown[];
    expect(attrs[2]).toBe('W-2');
    expect(attrs).toContain('.TRIPLE_PANEL_TOP.');
    const sets = (attrs[5] as string[]).map((ref) => view.getNewEntity(Number(ref.slice(1)))!);
    expect(sets.map((s) => s.type)).toEqual([
      'IfcWindowLiningProperties', 'IfcWindowPanelProperties', 'IfcWindowPanelProperties', 'IfcWindowPanelProperties',
      'IfcPropertySet', 'IfcPropertySet',
    ]);
    expect(sets[1].attributes).toContain('.TILTANDTURNLEFTHAND.');
    expect((sets[5].attributes as unknown[])[2]).toBe('Pset_IfcLiteJoinery');
    expect(attrs[6]).toEqual([`#${made.mapId}`]);
    const map = view.getNewEntity(made.mapId)!;
    const shape = view.getNewEntity(Number(String(map.attributes[1]).slice(1)))!;
    expect(shape.attributes[2]).toBe('SweptSolid');
    expect((shape.attributes[3] as unknown[]).length).toBe(joineryBoxes(spec).length);
  });

  it('writes an IfcDoorType and rewrites a type in place', () => {
    const { view, editor, anchor } = synthetic();
    const made = addJoineryTypeToStore(editor, anchor, defaultDoorSpec('D-90'));
    expect(view.getNewEntity(made.typeId)!.type).toBe('IfcDoorType');
    expect(view.getNewEntity(made.typeId)!.attributes).toContain('.SINGLE_SWING_LEFT.');
    const wider: JoinerySpec = { ...defaultDoorSpec('D-160'), width: 1.6, columns: [1, 1], panels: [{ col: 0, row: 0, operation: 'swing-left' }, { col: 1, row: 0, operation: 'swing-right' }] };
    replaceJoineryTypeInStore(editor, anchor, made.typeId, made.mapId, made.globalId, wider);
    const read = (id: number, i: number) => view.getPositionalMutationsForEntity(id)?.get(i);
    expect(read(made.typeId, 2)).toBe('D-160');
    expect([...(view.getPositionalMutationsForEntity(made.typeId)?.values() ?? [])]).toContain('.DOUBLE_DOOR_SINGLE_SWING.');
    expect(read(made.mapId, 1)).toMatch(/^#\d+$/);
  });

  it('maps a type body into an occurrence', () => {
    const { view, editor } = synthetic();
    const { shapeRepId } = emitMappedBody(editor, 5, 77);
    const rep = view.getNewEntity(shapeRepId)!;
    expect(rep.attributes[2]).toBe('MappedRepresentation');
    const item = view.getNewEntity(Number(String((rep.attributes[3] as string[])[0]).slice(1)))!;
    expect(item.type).toBe('IfcMappedItem');
    expect(item.attributes[0]).toBe('#77');
  });
});
