/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A parametric curtain wall: an IfcCurtainWall that keeps the spec it was
 * built from, as JSON in `Pset_IfcLiteCurtainWall`, so it is edited by its
 * parameters (the viewer's configurator) and regenerated in place:
 *
 *   - its line (start, end — storey-local metres, the base at start's Z) and
 *     height; how its U grid (along) and V grid (up) divide it — a count of
 *     equal bays, a fixed spacing (the remainder at the start, the end or
 *     split), a widest spacing (equal bays no wider), or explicit offsets;
 *   - mullion and transom sections, the perimeter frame, the panels'
 *     thickness and kind (glass or opaque), and colours;
 *   - the element type it follows (`typeId`, a project catalogue entry), if any.
 *
 * Regeneration builds the new layout, then moves each new part's placement
 * and body onto the old part with the same key (`curtain-wall.ts` tags them),
 * so a part that is still there keeps its entity and GlobalId; parts no
 * longer laid out are removed, new ones added, all in the caller's one edit.
 *
 * A curtain wall placed before it kept its spec is read back from its parts
 * (`inferCurtainWallSpec`, `curtain-wall-infer.ts`).
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { emitSurfaceStyle, ownerHistoryRef } from './_emit-helpers.js';
import { addCurtainWallToStore, curtainWallLayout, type CurtainWallGridSpec, type CurtainWallInStoreParams, type CurtainWallLayout } from './curtain-wall.js';
import { elementGeometryRefs, pruneOrphanOverlay } from './overlay-prune.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { stylePart } from './roof-system-style.js';

type Vec3 = [number, number, number];
type Attr = Parameters<StoreEditor['addEntity']>[1];

export const CURTAIN_WALL_PSET = 'Pset_IfcLiteCurtainWall';

/** How one direction of the grid divides the wall. */
export type CurtainGridRule =
  | { mode: 'count'; count: number }
  | { mode: 'spacing'; spacing: number; justify: 'start' | 'center' | 'end' }
  | { mode: 'max'; spacing: number }
  | { mode: 'offsets'; offsets: number[] };

export interface CurtainSection {
  /** In the wall's plane, across the member (metres). */
  width: number;
  /** Across the wall (metres). */
  depth: number;
}

/** What a curtain wall type holds: everything but where the wall is and how high. */
export interface CurtainWallTypeSpec {
  u: CurtainGridRule;
  v: CurtainGridRule;
  mullion: CurtainSection;
  transom: CurtainSection;
  /** Frame the perimeter with edge members. */
  edge: boolean;
  panel: { thickness: number; kind: 'glass' | 'opaque' };
  /** #rrggbb. */
  frameColor: string;
  glassColor: string;
  opaqueColor: string;
}

export interface CurtainWallSpec extends CurtainWallTypeSpec {
  version: 1;
  name: string;
  /** Storey-local metres; the base is at start's Z. */
  start: Vec3;
  end: Vec3;
  height: number;
  /** The project's element type it follows, when it has one. */
  typeId?: string;
}

export const DEFAULT_CURTAIN_WALL_TYPE: CurtainWallTypeSpec = {
  u: { mode: 'max', spacing: 1.5 },
  v: { mode: 'max', spacing: 1.5 },
  mullion: { width: 0.05, depth: 0.15 },
  transom: { width: 0.05, depth: 0.15 },
  edge: true,
  panel: { thickness: 0.024, kind: 'glass' },
  frameColor: '#3f3f46',
  glassColor: '#9cc3e6',
  opaqueColor: '#a1a1aa',
};

const EPS = 1e-6;
/** Glass is drawn see-through. */
const GLASS_ALPHA = 0.35;

/** The type part of a spec (what a catalogue entry carries). */
export function curtainWallTypeOf(spec: CurtainWallTypeSpec): CurtainWallTypeSpec {
  const { u, v, mullion, transom, edge, panel, frameColor, glassColor, opaqueColor } = spec;
  return { u, v, mullion, transom, edge, panel, frameColor, glassColor, opaqueColor };
}

/** A grid rule as the builder takes it, for a wall `extent` metres along that direction. */
export function resolveGrid(rule: CurtainGridRule, extent: number): CurtainWallGridSpec {
  switch (rule.mode) {
    case 'count':
      return Math.max(1, Math.round(rule.count));
    case 'max':
      return Math.max(1, Math.ceil(extent / Math.max(rule.spacing, EPS) - 1e-9));
    case 'spacing': {
      const s = Math.max(rule.spacing, EPS);
      const n = Math.floor(extent / s + 1e-9);
      const rest = extent - n * s;
      const first = rule.justify === 'start' ? rest : rule.justify === 'center' ? rest / 2 : 0;
      const lines: number[] = [];
      for (let i = 0; i <= n; i++) lines.push(first + i * s);
      const inside = lines.filter((x) => x > EPS && x < extent - EPS);
      return inside.length ? inside : 1;
    }
    case 'offsets': {
      const sorted = [...new Set(rule.offsets)].filter((x) => Number.isFinite(x) && x > EPS && x < extent - EPS).sort((a, b) => a - b);
      const kept = sorted.filter((x, i) => i === 0 || x - sorted[i - 1] > EPS);
      return kept.length ? kept : 1;
    }
  }
}

/** The builder's parameters for a spec. */
export function curtainWallParams(spec: CurtainWallSpec): CurtainWallInStoreParams {
  const length = Math.hypot(spec.end[0] - spec.start[0], spec.end[1] - spec.start[1]);
  return {
    Start: spec.start,
    End: [spec.end[0], spec.end[1], spec.start[2]],
    Height: spec.height,
    UGrid: resolveGrid(spec.u, length),
    VGrid: resolveGrid(spec.v, spec.height),
    MullionProfile: { Type: 'Rectangle', XDim: spec.mullion.width, YDim: spec.mullion.depth },
    TransomProfile: { Type: 'Rectangle', XDim: spec.transom.width, YDim: spec.transom.depth },
    PanelThickness: spec.panel.thickness,
    EdgeMembers: spec.edge,
    Name: spec.name,
  };
}

/** The layout a spec makes (pure), for previews; throws like the builder on an impossible one. */
export function curtainWallSpecLayout(spec: CurtainWallSpec): CurtainWallLayout {
  return curtainWallLayout(curtainWallParams(spec), 'curtainWallSpecLayout');
}

export interface CurtainWallSystemResult {
  curtainWallId: number;
  globalId: string;
  /** Every part, as it stands after the edit. */
  parts: number[];
  /** Parts removed by a regeneration. */
  removed: number[];
}

const hexRgb = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};

export const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

/** Colour every part: members the frame colour, panels glass (see-through) or opaque. */
function styleParts(editor: StoreEditor, anchor: SpatialAnchor, spec: CurtainWallSpec, parts: readonly number[]): void {
  const schema = anchor.schema ?? 'IFC4';
  const view = editor.getMutationView();
  const frame = emitSurfaceStyle(editor, schema, hexRgb(spec.frameColor), `${spec.name} frame`).styleRefId;
  const panel = spec.panel.kind === 'glass'
    ? emitSurfaceStyle(editor, schema, { ...hexRgb(spec.glassColor), alpha: GLASS_ALPHA }, `${spec.name} glass`).styleRefId
    : emitSurfaceStyle(editor, schema, hexRgb(spec.opaqueColor), `${spec.name} panel`).styleRefId;
  for (const id of parts) {
    const attrs = view.getNewEntity(id)?.attributes;
    const shape = refId(attrs?.[6]);
    if (shape === null) continue;
    stylePart(editor, shape, String(attrs?.[7] ?? '').startsWith('panel:') ? panel : frame);
  }
}

function specValue(spec: CurtainWallSpec) {
  return { typed: { type: 'IfcText', value: JSON.stringify(spec) } };
}

function writeSpec(editor: StoreEditor, anchor: SpatialAnchor, curtainWallId: number, spec: CurtainWallSpec): void {
  const owner = ownerHistoryRef(anchor.ownerHistoryId);
  const prop = editor.addEntity('IfcPropertySingleValue', ['Spec', null, specValue(spec), null]).expressId;
  const pset = editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), owner, CURTAIN_WALL_PSET, null, [`#${prop}`]]).expressId;
  editor.addEntity('IfcRelDefinesByProperties', [generateIfcGuid(anchor.guidRandom), owner, null, null, [`#${curtainWallId}`], `#${pset}`]);
}

/** A new parametric curtain wall on the anchor's storey. */
export function addCurtainWallSystemToStore(editor: StoreEditor, anchor: SpatialAnchor, spec: CurtainWallSpec, params: { GlobalId?: string } = {}): CurtainWallSystemResult {
  const built = addCurtainWallToStore(editor, anchor, { ...curtainWallParams(spec), ...(params.GlobalId ? { GlobalId: params.GlobalId } : {}) });
  const parts = [...built.mullionIds, ...built.transomIds, ...built.panelIds];
  styleParts(editor, anchor, spec, parts);
  writeSpec(editor, anchor, built.curtainWallId, spec);
  const globalId = editor.getMutationView().getNewEntity(built.curtainWallId)?.attributes[0];
  return { curtainWallId: built.curtainWallId, globalId: typeof globalId === 'string' ? globalId : '', parts, removed: [] };
}

export interface CurtainRead {
  spec: CurtainWallSpec | null;
  propertyId: number | null;
  aggregateId: number | null;
  parts: { id: number; tag: string; name: string }[];
}

/** A curtain wall's kept spec (if any), aggregation and keyed parts; null when `id` is not a curtain wall. */
export function readCurtain(store: IfcDataStore, curtainWallId: number, view?: MutablePropertyView | null): CurtainRead | null {
  const reader = new AnchorEntityReader(store, view);
  const wall = reader.entity(curtainWallId);
  if (wall?.type.toUpperCase() !== 'IFCCURTAINWALL') return null;
  let spec: CurtainWallSpec | null = null;
  let propertyId: number | null = null;
  for (const relId of reader.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = reader.entity(relId);
    if (!rel || !Array.isArray(rel.attributes[4]) || !rel.attributes[4].some((r) => refId(r) === curtainWallId)) continue;
    const set = reader.entity(refId(rel.attributes[5]) ?? -1);
    if (!set || set.attributes[2] !== CURTAIN_WALL_PSET) continue;
    for (const p of Array.isArray(set.attributes[4]) ? set.attributes[4] : []) {
      const prop = reader.entity(refId(p) ?? -1);
      if (prop?.attributes[0] !== 'Spec') continue;
      const v = prop.attributes[2] as unknown;
      const raw = Array.isArray(v) ? v[1] : v && typeof v === 'object' && 'typed' in v ? (v as { typed: { value: unknown } }).typed.value : v;
      try {
        spec = { ...DEFAULT_CURTAIN_WALL_TYPE, ...(JSON.parse(String(raw)) as CurtainWallSpec) };
        propertyId = refId(p);
      } catch { spec = null; }
    }
  }
  let aggregateId: number | null = null;
  const parts: CurtainRead['parts'] = [];
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    if (!rel || refId(rel.attributes[4]) !== curtainWallId) continue;
    aggregateId = relId;
    for (const r of Array.isArray(rel.attributes[5]) ? rel.attributes[5] : []) {
      const id = refId(r);
      const part = id === null ? null : reader.entity(id);
      if (part && id !== null) parts.push({ id, tag: typeof part.attributes[7] === 'string' ? part.attributes[7] : '', name: typeof part.attributes[2] === 'string' ? part.attributes[2] : '' });
    }
  }
  return { spec, propertyId, aggregateId, parts };
}

/** The spec a curtain wall keeps, or null when it keeps none (or `id` is not a curtain wall). */
export function readCurtainWallSystem(store: IfcDataStore, curtainWallId: number, view?: MutablePropertyView | null): CurtainWallSpec | null {
  return readCurtain(store, curtainWallId, view)?.spec ?? null;
}

/** The parts of a curtain wall (mullions, transoms, panels). */
export function curtainWallParts(store: IfcDataStore, curtainWallId: number, view?: MutablePropertyView | null): number[] {
  return readCurtain(store, curtainWallId, view)?.parts.map((p) => p.id) ?? [];
}

/** The curtain wall an element is or belongs to, or null. */
export function curtainWallOf(store: IfcDataStore, elementId: number, view?: MutablePropertyView | null): number | null {
  const reader = new AnchorEntityReader(store, view);
  if (reader.entity(elementId)?.type.toUpperCase() === 'IFCCURTAINWALL') return elementId;
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    const parts = rel?.attributes[5];
    if (!Array.isArray(parts) || !parts.some((r) => refId(r) === elementId)) continue;
    const whole = refId(rel!.attributes[4]);
    if (whole !== null && reader.entity(whole)?.type.toUpperCase() === 'IFCCURTAINWALL') return whole;
  }
  return null;
}

/**
 * Rebuild curtain wall `curtainWallId` to `spec`, in place: the parts that are
 * still laid out keep their entities (and GlobalIds), take their new
 * placement and body; the others are removed, new ones added. A curtain wall
 * that kept no spec starts keeping this one.
 */
export function regenerateCurtainWallInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, curtainWallId: number, spec: CurtainWallSpec): CurtainWallSystemResult {
  const view = editor.getMutationView();
  const current = readCurtain(store, curtainWallId, view);
  if (!current) throw new Error(`#${curtainWallId} is not a curtain wall`);
  const reader = new AnchorEntityReader(store, view);
  const oldPlacement = reader.entity(curtainWallId)?.attributes[5];
  const stale = [...current.parts.flatMap((p) => elementGeometryRefs(editor, p.id)), ...(refId(oldPlacement) !== null ? [refId(oldPlacement)!] : [])];

  // The new layout, built whole as a scratch curtain wall…
  const built = addCurtainWallToStore(editor, anchor, curtainWallParams(spec));
  const fresh = [...built.mullionIds, ...built.transomIds, ...built.panelIds];
  // …whose placement the curtain wall takes (every part is placed relative to it)…
  editor.setPositionalAttribute(curtainWallId, 5, editor.getMutationView().getNewEntity(built.curtainWallId)!.attributes[5] as Attr[number]);
  // …and whose parts' geometry moves onto the old parts with the same key.
  const existing = new Map(current.parts.filter((p) => p.tag).map((p) => [p.tag, p.id]));
  const parts: number[] = [];
  for (const id of fresh) {
    const attrs = editor.getMutationView().getNewEntity(id)!.attributes;
    const tag = String(attrs[7] ?? '');
    const old = existing.get(tag);
    if (old === undefined) {
      parts.push(id);
      continue;
    }
    existing.delete(tag);
    editor.setPositionalAttribute(old, 2, attrs[2] as Attr[number]);
    editor.setPositionalAttribute(old, 5, attrs[5] as Attr[number]);
    editor.setPositionalAttribute(old, 6, attrs[6] as Attr[number]);
    editor.setPositionalAttribute(old, 7, tag);
    editor.removeEntity(id);
    parts.push(old);
  }
  // A curtain wall placed before parts were keyed: its untagged parts all go.
  const removed = [...existing.values(), ...current.parts.filter((p) => !p.tag).map((p) => p.id)];
  for (const id of removed) editor.removeEntity(id);
  editor.removeEntity(built.relAggregatesId);
  editor.removeEntity(built.relContainedId);
  editor.removeEntity(built.curtainWallId);
  pruneOrphanOverlay(editor, stale);

  if (current.aggregateId !== null) editor.setPositionalAttribute(current.aggregateId, 5, parts.map((id) => `#${id}`));
  else editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${curtainWallId}`, parts.map((id) => `#${id}`)]);
  styleParts(editor, anchor, spec, parts);
  if (current.propertyId !== null) editor.setPositionalAttribute(current.propertyId, 2, specValue(spec));
  else writeSpec(editor, anchor, curtainWallId, spec);
  editor.setPositionalAttribute(curtainWallId, 2, spec.name);
  const globalId = reader.entity(curtainWallId)?.attributes[0];
  return { curtainWallId, globalId: typeof globalId === 'string' ? globalId : '', parts, removed };
}
