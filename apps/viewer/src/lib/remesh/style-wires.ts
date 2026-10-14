/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The colours a re-mesh gives geometry items: the model's style wire (read
 * once per load from its source, by the re-mesh worker) and this session's
 * styled items and material colours on top. The IFC re-mesh sends them to
 * the engine; the native one looks its parts' colours up in them.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { materialIdsByElement } from '@ifc-lite/create';
import type { StyleWire } from '@ifc-lite/geometry/remesh';
import { materialColourWire, overlayMaterialColours, overlayStyleWire, withOverlayStyles } from './overlay-style-wire';

const styleWires = new WeakMap<IfcDataStore, Promise<StyleWire>>();
const readyWires = new WeakMap<IfcDataStore, StyleWire>();

/**
 * The model's style wire with this session's styled items added
 * (`overlay-style-wire.ts`), and the material colours it gave (by material,
 * and by first material for the elements re-meshed), as filterStyleWire's
 * first two arguments.
 */
export function stylesWithOverlay(
  wire: { styleIds: Uint32Array; styleColors: Uint8Array }, store: IfcDataStore, view: MutablePropertyView | null, targets: ReadonlySet<number>,
): [Uint32Array, Uint8Array] {
  if (!view) return [wire.styleIds, wire.styleColors];
  const src = {
    entities: () => view.getNewEntities().filter((e) => !view.isDeleted(e.expressId)),
    attributes: (id: number) => {
      if (view.isDeleted(id)) return null;
      const base = view.getNewEntity(id)?.attributes ?? store.getEntity(id)?.attributes;
      if (!base) return null;
      const edits = view.getPositionalMutationsForEntity(id);
      if (!edits?.size) return base;
      const attrs = [...base];
      for (const [index, value] of edits) attrs[index] = value;
      return attrs;
    },
  };
  let merged = withOverlayStyles(wire, overlayStyleWire(src));
  const materials = overlayMaterialColours(src);
  if (materials.size) merged = withOverlayStyles(merged, materialColourWire(materials, materialIdsByElement(store, view, targets)));
  return [merged.styleIds, merged.styleColors];
}

/** The model's style wire, captured once per load; synchronous once captured. */
export function styleWireFor(worker: { styleWire(source: Uint8Array): Promise<StyleWire> }, store: IfcDataStore): StyleWire | Promise<StyleWire> {
  const ready = readyWires.get(store);
  if (ready) return ready;
  let wire = styleWires.get(store);
  if (!wire) {
    wire = store.source.withMaterializedAsync((bytes) => worker.styleWire(bytes));
    styleWires.set(store, wire);
    wire.then((captured) => readyWires.set(store, captured), () => styleWires.delete(store));
  }
  return wire;
}

/** The model's style wire if it was captured already (null until the first re-mesh reads it). */
export const readyStyleWire = (store: IfcDataStore): StyleWire | null => readyWires.get(store) ?? null;
