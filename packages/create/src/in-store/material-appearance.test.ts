/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A material's appearance in IFC: written (surface colour + one hatch per
 * view), read back the same, replaced without leftovers, and the elements
 * that show it found through layer sets and types. Fixture: hello-wall,
 * whose wall #1222 is CONCRETE (#259) through its type's layer set.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { elementsWithMaterials, materialIdsByElement, materialsNamed, readMaterialAppearance, viewOfFillStyle, writeMaterialAppearance } from './material-appearance.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);
const CONCRETE = 259;
const WALL = 1222;

async function session() {
  const bytes = await readFile(SAMPLE);
  const store = await new IfcParser().parseColumnar(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { disableWorkerScan: true },
  );
  const view = new MutablePropertyView(null, 'm');
  return { store, view, editor: new StoreEditor(store, view) };
}

const count = (view: MutablePropertyView, type: string) => view.getNewEntities().filter((e) => e.type.toUpperCase() === type && !view.isDeleted(e.expressId)).length;

describe('material appearance', () => {
  it('writes the surface colour and a hatch per view, and reads them back', async () => {
    const { store, view, editor } = await session();
    expect(readMaterialAppearance(store, view, CONCRETE)).toBeNull();
    writeMaterialAppearance(store, editor, CONCRETE, 'CONCRETE', {
      color: '#a0a0a0',
      hatches: { section: { pattern: 'CONCRETE', scale: 1.5, background: '#eeeeee' }, elevation: { pattern: 'BRICK' } },
    });
    expect(readMaterialAppearance(store, view, CONCRETE)).toEqual({
      color: '#a0a0a0',
      hatches: { section: { pattern: 'CONCRETE', scale: 1.5, background: '#eeeeee' }, elevation: { pattern: 'BRICK' } },
    });
    // Surface and fills are separate styled items, under one definition representation.
    expect(count(view, 'IFCMATERIALDEFINITIONREPRESENTATION')).toBe(1);
    expect(count(view, 'IFCSTYLEDITEM')).toBe(3);
  });

  it('a new appearance replaces the old one, leaving nothing behind', async () => {
    const { store, view, editor } = await session();
    writeMaterialAppearance(store, editor, CONCRETE, 'CONCRETE', { color: '#a0a0a0', hatches: { plan: { pattern: 'CONCRETE' } } });
    writeMaterialAppearance(store, editor, CONCRETE, 'CONCRETE', { color: '#ff0000' });
    expect(readMaterialAppearance(store, view, CONCRETE)).toEqual({ color: '#ff0000' });
    expect(count(view, 'IFCMATERIALDEFINITIONREPRESENTATION')).toBe(1);
    expect(count(view, 'IFCFILLAREASTYLE')).toBe(0);
    expect(count(view, 'IFCEXTERNALLYDEFINEDHATCHSTYLE')).toBe(0);
    writeMaterialAppearance(store, editor, CONCRETE, 'CONCRETE', {});
    expect(readMaterialAppearance(store, view, CONCRETE)).toBeNull();
    expect(count(view, 'IFCSURFACESTYLE')).toBe(0);
  });

  it('finds materials by name and the elements that show them (through a type layer set)', async () => {
    const { store, view } = await session();
    expect(materialsNamed(store, view, ' concrete ')).toEqual([CONCRETE]);
    expect(elementsWithMaterials(store, view, [CONCRETE])).toContain(WALL);
    // In order, through its type's layer set.
    expect(materialIdsByElement(store, view, [WALL]).get(WALL)).toEqual([CONCRETE]);
  });

  it('tells the view a fill style is for by its name', () => {
    expect(viewOfFillStyle('Plan')).toBe('plan');
    expect(viewOfFillStyle('Concrete - Surface Pattern')).toBe('elevation');
    expect(viewOfFillStyle('Cut')).toBe('section');
    expect(viewOfFillStyle(null)).toBe('section');
  });
});
