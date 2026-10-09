/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A roof system's part styling — each part its own colour (an override),
 * else the covering's or the timber's — and its spec settled against what the
 * geometry generates (overrides of parts that are gone dropped).
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import type { SpatialAnchor } from './anchor.js';
import { emitSurfaceStyle } from './_emit-helpers.js';
import type { RoofGeometry } from './roof-system.js';
import type { RoofMember } from './roof-structure.js';
import { pruneOverrides } from './roof-overrides.js';
import type { RoofSystemSpec } from './roof-system-store.js';

const rgb = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 } : { red: 0.6, green: 0.4, blue: 0.3 };
};

/** Colour every item of a product we just wrote. */
export function stylePart(editor: StoreEditor, productShapeId: number, styleRef: number): void {
  const view = editor.getMutationView();
  const ref = (v: unknown) => (typeof v === 'string' && v.startsWith('#') ? Number(v.slice(1)) : null);
  for (const rep of (view.getNewEntity(productShapeId)?.attributes[2] as unknown[] | undefined) ?? []) {
    const repId = ref(rep);
    for (const item of (repId === null ? [] : (view.getNewEntity(repId)?.attributes[3] as unknown[] | undefined)) ?? []) {
      editor.addEntity('IfcStyledItem', [item as string, [`#${styleRef}`], null]);
    }
  }
}

/** The style each part takes: its own colour, else the covering's (planes) or the timber's (members). */
export function partStyles(editor: StoreEditor, anchor: SpatialAnchor, spec: Pick<RoofSystemSpec, 'name' | 'covering' | 'timberColor'>): (plan: { key: string; color?: string }) => number {
  const schema = anchor.schema ?? 'IFC4';
  const cache = new Map<string, number>();
  const style = (color: string, name: string) => {
    let id = cache.get(color);
    if (id === undefined) cache.set(color, (id = emitSurfaceStyle(editor, schema, rgb(color), name).styleRefId));
    return id;
  };
  return (plan) => plan.color
    ? style(plan.color, `${spec.name} ${plan.key}`)
    : plan.key.startsWith('plane:') ? style(spec.covering.color, `${spec.name} covering`) : style(spec.timberColor, `${spec.name} timber`);
}

/** Every part key the geometry generates (deleted ones included), and the spec with stale overrides dropped. */
export function settledSpec(spec: RoofSystemSpec, g: RoofGeometry, members: readonly RoofMember[]): RoofSystemSpec {
  const keys = new Set([...g.planes.map((p) => `plane:${p.edge}`), ...members.map((m) => m.key)]);
  const overrides = pruneOverrides(spec.overrides, keys);
  const { overrides: _old, ...rest } = spec;
  return overrides ? { ...rest, overrides } : rest;
}

