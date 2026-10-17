/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC presentation layers (`IfcPresentationLayerAssignment`, the CAD layers
 * Revit and ArchiCAD export, e.g. "A-WALL"): a layer is assigned shape
 * representations or their items, and an element is on the layers of its
 * representations and of their items. Read once per index (the assignments),
 * then per element asked for, memoised: a view asks only for what it draws.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { refId } from './host-geometry-frame.js';
import { AnchorEntityReader } from './resolve-anchor.js';

const LAYER_CLASSES = ['IFCPRESENTATIONLAYERASSIGNMENT', 'IFCPRESENTATIONLAYERWITHSTYLE'];

export class PresentationLayerIndex {
  private readonly reader: AnchorEntityReader;
  private readonly onItem = new Map<number, string[]>();
  private readonly byElement = new Map<number, readonly string[]>();
  /** The model's layer names, in file order, each once. */
  readonly names: readonly string[];

  constructor(store: IfcDataStore, view?: MutablePropertyView | null) {
    this.reader = new AnchorEntityReader(store, view);
    const names = new Set<string>();
    for (const type of LAYER_CLASSES) {
      for (const id of this.reader.ids(type)) {
        const layer = this.reader.entity(id);
        const name = typeof layer?.attributes[0] === 'string' ? layer.attributes[0] : '';
        if (!name || !Array.isArray(layer?.attributes[2])) continue;
        names.add(name);
        for (const item of layer.attributes[2] as unknown[]) {
          const itemId = refId(item);
          if (itemId === null) continue;
          const on = this.onItem.get(itemId);
          if (on) { if (!on.includes(name)) on.push(name); } else this.onItem.set(itemId, [name]);
        }
      }
    }
    this.names = [...names];
  }

  /** The layers `expressId` is on (its representations' and their items'); empty when none. */
  of(expressId: number): readonly string[] {
    const known = this.byElement.get(expressId);
    if (known) return known;
    const out = new Set<string>();
    if (this.onItem.size) {
      const shape = this.reader.entity(refId(this.reader.entity(expressId)?.attributes[6]) ?? -1);
      const reps = Array.isArray(shape?.attributes[2]) ? (shape!.attributes[2] as unknown[]) : [];
      for (const r of reps) {
        const repId = refId(r);
        if (repId === null) continue;
        for (const name of this.onItem.get(repId) ?? []) out.add(name);
        const items = this.reader.entity(repId)?.attributes[3];
        for (const item of Array.isArray(items) ? items : []) for (const name of this.onItem.get(refId(item) ?? -1) ?? []) out.add(name);
      }
    }
    const layers = [...out];
    this.byElement.set(expressId, layers);
    return layers;
  }
}
