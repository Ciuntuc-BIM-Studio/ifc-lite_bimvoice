/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Convert to native" for an imported IFC (N7, decision 5): what of it the
 * native schema already describes (walls, slabs, beams, columns, openings the
 * lift reads: editable as they are), what it can become, and what stays IFC
 * geometry, with why.
 *
 * What it can become today: a door or window hosted in a wall, with no Lapin
 * joinery type. It takes a joinery type of its size (one per class and size,
 * `D 900×2100`, a stable id so a second conversion reuses it), configurable
 * afterwards like any other, through the same retype the configurator runs
 * (`retypeOccurrencesInStore`): its body becomes the type's.
 */

import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { getModelLengthUnitScale } from '../in-store/edit/length-unit-scale.js';
import { readHostedFill } from '../in-store/hosted-fill-read.js';
import { placedBodyExtent } from '../in-store/resolve-host.js';
import { defaultDoorSpec, defaultWindowSpec, type JoinerySpec } from '../in-store/joinery-spec.js';
import { retypeOccurrencesInStore } from '../in-store/joinery-sync.js';
import { liftNativeModel } from './lift.js';
import { AnchorEntityReader } from '../in-store/resolve-anchor.js';

export interface NativeConversionPlan {
  /** Elements the native schema describes as they are. */
  native: number;
  /** Doors and windows that take a joinery type, grouped by the type they take. */
  joinery: Array<{ spec: JoinerySpec; ids: number[] }>;
  /** What stays IFC geometry: reason -> count. */
  remaining: Array<[reason: string, count: number]>;
}

const NO_TYPE = 'no configured joinery type';
const JOINERY_CLASSES = ['IFCDOOR', 'IFCDOORSTANDARDCASE', 'IFCWINDOW', 'IFCWINDOWSTANDARDCASE'];
const mm = (m: number) => Math.round(m * 1000);

/**
 * The joinery type a door or window of this size takes when it has none
 * (`Door 900×2100`): one per class and size in millimetres, its id stable so
 * the conversion and the Door / Window tools share it.
 */
export function sizedJoinerySpec(kind: 'door' | 'window', width: number, height: number, sill: number): JoinerySpec {
  const [w, h] = [mm(width), mm(height)];
  const base = kind === 'door' ? defaultDoorSpec() : defaultWindowSpec();
  const name = `${kind === 'door' ? 'Door' : 'Window'} ${w}×${h}`;
  return { ...base, id: `conv-${kind}-${w}x${h}`, name, width: w / 1000, height: h / 1000, sillHeight: kind === 'window' ? sill : 0 };
}

/** What converting `store` (with `view`'s edits) would do. */
export function planNativeConversion(store: IfcDataStore, view: MutablePropertyView): NativeConversionPlan {
  // Only doors and windows can be converted: a model without any is not lifted at all (a whole lift of
  // a large model is seconds on the main thread). Its `native` count is then not known, and not needed.
  const reader = new AnchorEntityReader(store, view);
  if (!JOINERY_CLASSES.some((type) => !reader.ids(type).next().done)) return { native: 0, joinery: [], remaining: [] };
  // Only its doors and windows matter here: plain extrusions are not read as solids.
  const lifted = liftNativeModel(store, view, { id: '00000000-0000-4000-8000-000000000000', name: '' }, { geometrySolids: false });
  const scale = getModelLengthUnitScale(store);
  const groups = new Map<string, { spec: JoinerySpec; ids: number[] }>();
  const remaining = new Map<string, number>();
  const keep = (reason: string) => remaining.set(reason, (remaining.get(reason) ?? 0) + 1);
  for (const skipped of lifted.skipped) {
    // As the source spells it: IFCDOOR parsed, IfcDoor authored (and the StandardCase subtypes).
    const type = skipped.ifcType.toUpperCase();
    const kind = type.startsWith('IFCDOOR') ? 'door' : type.startsWith('IFCWINDOW') ? 'window' : null;
    if (!kind || skipped.reason !== NO_TYPE) { keep(skipped.reason); continue; }
    const fill = readHostedFill(store, skipped.expressId, view);
    const cut = fill ? placedBodyExtent(store, fill.openingId, view) : null;
    if (!fill || !cut) { keep('a door or window whose opening cannot be read'); continue; }
    const [w, h] = [(cut.max[0] - cut.min[0]) * scale, (cut.max[2] - cut.min[2]) * scale];
    if (mm(w) <= 0 || mm(h) <= 0) { keep('a door or window whose opening cannot be read'); continue; }
    const spec = sizedJoinerySpec(kind, w, h, fill.sill);
    const key = spec.id ?? spec.name;
    let group = groups.get(key);
    if (!group) {
      group = { spec, ids: [] };
      groups.set(key, group);
    }
    group.ids.push(skipped.expressId);
  }
  return { native: lifted.model.elements.length, joinery: [...groups.values()], remaining: [...remaining] };
}

export interface NativeConversionResult {
  converted: number;
  refused: Array<{ id: number; reason: string }>;
  /** The elements to re-mesh. */
  remesh: number[];
}

/** Convert what `plan` says can be converted; the caller owns the atomic commit. */
export function convertToNativeInStore(store: IfcDataStore, editor: StoreEditor, plan: NativeConversionPlan): NativeConversionResult {
  const out: NativeConversionResult = { converted: 0, refused: [], remesh: [] };
  for (const { spec, ids } of plan.joinery) {
    const result = retypeOccurrencesInStore(store, editor, spec, ids);
    out.converted += ids.length - result.refused.length;
    out.refused.push(...result.refused);
    out.remesh.push(...result.remesh);
  }
  out.remesh = [...new Set(out.remesh)];
  return out;
}
