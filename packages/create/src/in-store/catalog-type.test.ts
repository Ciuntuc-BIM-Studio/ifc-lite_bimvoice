/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Catalogue types in a model: written once per entry (found again by its
 * id), carrying their layer set; a changed entry renames the type, rewrites
 * its spec and moves every usage to the new layer set, the old one leaving.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addWallToStore } from './wall.js';
import { addMaterialLayerSetUsageToStore, assignMaterialInStore } from './material.js';
import { assignTypeInStore } from './element-type.js';
import { readRelatedLists } from './resolve-relations.js';
import { catalogTypeOfElement, ensureCatalogTypeInStore, findCatalogTypeInStore, readCatalogType, rewriteCatalogTypeInStore } from './catalog-type.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);

async function session() {
  const bytes = await readFile(SAMPLE);
  const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  return { store, view, editor: new StoreEditor(store, view), anchor: resolveSpatialAnchor(store, 42, view) };
}

const brick = (outer: number) => ({
  id: 'type-1', ifcClass: 'IfcWallType', name: 'Brick 30', mark: 'W1',
  layers: [{ name: 'Plaster', thickness: 0.02 }, { name: 'Brick', thickness: outer }, { name: 'Plaster', thickness: 0.02 }],
  spec: { kind: 'wall', outer },
});

describe('catalogue types', () => {
  it('writes an entry once, with its layer set, and finds it again', async () => {
    const { store, view, editor, anchor } = await session();
    const made = ensureCatalogTypeInStore(store, editor, anchor, brick(0.25));
    expect(view.getNewEntity(made.typeId)?.type).toBe('IfcWallType');
    expect(made.layerSetId).not.toBeNull();
    expect(ensureCatalogTypeInStore(store, editor, anchor, brick(0.25)).typeId).toBe(made.typeId);
    expect(findCatalogTypeInStore(store, 'type-1', 'IfcWallType', view)?.typeId).toBe(made.typeId);
    expect(readCatalogType(store, made.typeId, view)?.spec).toEqual({ kind: 'wall', outer: 0.25 });
    const text = new TextDecoder().decode(new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content);
    expect(text).toMatch(/IFCWALLTYPE\('[^']+',[^;]*'Brick 30'/);
    expect(text).toContain("'Pset_IfcLiteType'");
    expect(text).toContain('IFCMATERIALDEFINITIONREPRESENTATION(');
  });

  it('follows a changed entry: name, spec, and the usages moved to the new layer set', async () => {
    const { store, view, editor, anchor } = await session();
    const made = ensureCatalogTypeInStore(store, editor, anchor, brick(0.25));
    const wall = addWallToStore(editor, anchor, { Start: [0, 0, 0], End: [4, 0, 0], Thickness: 0.29, Height: 3 });
    assignTypeInStore(editor, anchor, made.typeId, [wall.wallId], readRelatedLists(store, 'IfcRelDefinesByType', view));
    const usage = addMaterialLayerSetUsageToStore(editor, anchor, { ForLayerSet: made.layerSetId!, OffsetFromReferenceLine: -0.145 }).usageId;
    assignMaterialInStore(editor, anchor, usage, [wall.wallId], readRelatedLists(store, 'IfcRelAssociatesMaterial', view));
    expect(catalogTypeOfElement(store, wall.wallId, view)?.id).toBe('type-1');

    const count = view.getNewEntities().length;
    const next = { ...brick(0.3), name: 'Brick 35' };
    const out = rewriteCatalogTypeInStore(store, editor, anchor, made, next);
    expect(out.usages).toEqual([usage]);
    expect(view.getPositionalMutationsForEntity(usage)?.get(0)).toBe(`#${out.layerSetId}`);
    expect(view.getNewEntity(made.layerSetId!)).toBeNull();
    expect(readCatalogType(store, made.typeId, view)?.spec).toEqual({ kind: 'wall', outer: 0.3 });
    expect(view.getPositionalMutationsForEntity(made.typeId)?.get(2)).toBe('Brick 35');
    // The old set, layers, materials and colours went: the overlay did not grow.
    expect(view.getNewEntities().length).toBe(count);
  });
});
