/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * An IfcMaterial's appearance as IFC carries it, read and written:
 *
 *   IfcMaterialDefinitionRepresentation (RepresentedMaterial = the material)
 *     └ IfcStyledRepresentation ('Style') → IfcStyledItem (no Item) → styles
 *
 * - its surface colour: the IfcSurfaceStyle every renderer (the geometry
 *   engine here included) gives the material's elements and layers in 3D;
 * - its drafting hatches: one IfcFillAreaStyle per kind of view, a named
 *   pattern (IfcExternallyDefinedHatchStyle) and an optional background
 *   colour. The style's name says the view: "Plan", "Elevation" or "Section"
 *   ("Cut" and unnamed ones are read as the section's). Line hatchings
 *   (IfcFillAreaStyleHatching, as other programs write them) are read as
 *   their angle and spacing.
 *
 * Each fill style is a styled item of its own, so a reader looking for the
 * surface colour never meets a hatch.
 */

import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { emitSurfaceStyle } from './_emit-helpers.js';
import { pruneOrphanOverlay } from './overlay-prune.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { asRef, refList } from './style-entity-reader.js';

export type MaterialViewKind = 'plan' | 'elevation' | 'section';
export const MATERIAL_VIEW_KINDS: readonly MaterialViewKind[] = ['plan', 'elevation', 'section'];

export interface MaterialHatchStyle {
  /** A hatch pattern's name (the drafting library's); absent for a line hatching read from a file. */
  pattern?: string;
  /** The pattern's scale (1 = its own size). */
  scale?: number;
  /** A line hatching read from a file: its angle (degrees) and line spacing (model units, metres when written here). */
  lines?: { angleDeg: number; spacing: number };
  /** Colour behind the hatch (#rrggbb); absent: none. */
  background?: string;
}

export interface MaterialAppearance {
  /** Surface colour (#rrggbb). */
  color?: string;
  /** 0 = opaque. */
  transparency?: number;
  hatches?: Partial<Record<MaterialViewKind, MaterialHatchStyle>>;
}

const FILL_NAMES: Record<MaterialViewKind, string> = { plan: 'Plan', elevation: 'Elevation', section: 'Section' };
/** Marks the hatch styles this module writes, so a pattern's scale reads back exactly. */
const HATCH_LOCATION = 'lapin:hatch';

export function viewOfFillStyle(name: unknown): MaterialViewKind {
  const n = typeof name === 'string' ? name.toLowerCase() : '';
  if (/plan|top/.test(n)) return 'plan';
  if (/elev|front|surface|projection|facade|façade/.test(n)) return 'elevation';
  return 'section';
}

const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'value' in v) return num((v as { value: unknown }).value);
  if (v && typeof v === 'object' && 'real' in v) return num((v as { real: unknown }).real);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

type Reader = Pick<AnchorEntityReader, 'entity' | 'ids'>;

function colourOf(reader: Reader, id: number | null): string | undefined {
  const c = id === null ? null : reader.entity(id);
  if (!c || c.type.toUpperCase() !== 'IFCCOLOURRGB') return undefined;
  const [r, g, b] = [1, 2, 3].map((i) => num(c.attributes[i]));
  return r === null || g === null || b === null ? undefined : `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** The styles a styled item lists, IFC2X3's IfcPresentationStyleAssignment opened up. */
function stylesOf(reader: Reader, itemId: number): number[] {
  const out: number[] = [];
  for (const id of refList(reader.entity(itemId)?.attributes[1])) {
    const s = reader.entity(id);
    if (s?.type.toUpperCase() === 'IFCPRESENTATIONSTYLEASSIGNMENT') out.push(...refList(s.attributes[0]));
    else out.push(id);
  }
  return out;
}

function readSurface(reader: Reader, styleId: number, into: MaterialAppearance): void {
  for (const id of refList(reader.entity(styleId)?.attributes[2])) {
    const shading = reader.entity(id);
    if (!shading || !/^IFCSURFACESTYLE(SHADING|RENDERING)$/.test(shading.type.toUpperCase())) continue;
    into.color ??= colourOf(reader, asRef(shading.attributes[0]));
    const t = num(shading.attributes[1]);
    if (t !== null && t > 0) into.transparency ??= t;
  }
}

function readFill(reader: Reader, styleId: number): MaterialHatchStyle {
  const out: MaterialHatchStyle = {};
  for (const id of refList(reader.entity(styleId)?.attributes[1])) {
    const s = reader.entity(id);
    const type = s?.type.toUpperCase();
    if (!s) continue;
    if (type === 'IFCCOLOURRGB') out.background ??= colourOf(reader, id);
    else if (type === 'IFCEXTERNALLYDEFINEDHATCHSTYLE') {
      const pattern = typeof s.attributes[1] === 'string' ? s.attributes[1] : typeof s.attributes[2] === 'string' ? s.attributes[2] : null;
      if (pattern) out.pattern = pattern;
      const scale = s.attributes[0] === HATCH_LOCATION && typeof s.attributes[2] === 'string' ? /\bx([\d.]+)$/.exec(s.attributes[2]) : null;
      if (scale) out.scale = Number(scale[1]);
    } else if (type === 'IFCFILLAREASTYLEHATCHING' && !out.pattern) {
      const angle = num(s.attributes[4]) ?? 0;
      const start = s.attributes[1];
      let spacing = num(start);
      // StartOfNextHatchLine may be an IfcVector (its magnitude is the spacing).
      const vector = spacing === null ? reader.entity(asRef(start) ?? -1) : null;
      if (vector?.type.toUpperCase() === 'IFCVECTOR') spacing = num(vector.attributes[1]);
      if (spacing !== null && spacing > 0) out.lines = { angleDeg: angle, spacing };
    }
  }
  return out;
}

/** The appearance IFC gives `materialId`, or null when it has none. */
export function readMaterialAppearance(store: IfcDataStore | null, view: MutablePropertyView | null | undefined, materialId: number): MaterialAppearance | null {
  const reader = new AnchorEntityReader(store, view);
  const out: MaterialAppearance = {};
  for (const defId of reader.ids('IFCMATERIALDEFINITIONREPRESENTATION')) {
    const def = reader.entity(defId);
    if (!def || asRef(def.attributes[3]) !== materialId) continue;
    for (const repId of refList(def.attributes[2])) {
      for (const itemId of refList(reader.entity(repId)?.attributes[3])) {
        for (const styleId of stylesOf(reader, itemId)) {
          const style = reader.entity(styleId);
          const type = style?.type.toUpperCase();
          if (type === 'IFCSURFACESTYLE') readSurface(reader, styleId, out);
          else if (type === 'IFCFILLAREASTYLE') {
            const kind = viewOfFillStyle(style!.attributes[0]);
            const fill = readFill(reader, styleId);
            if (fill.pattern || fill.lines || fill.background) (out.hatches ??= {})[kind] ??= fill;
          }
        }
      }
    }
  }
  return out.color || out.hatches ? out : null;
}

const rgb = (h: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 } : null;
};

/** Every appearance record of `materialId`: the definition representations, their styled representations and items. */
function appearanceRecords(reader: Reader, materialId: number): { defs: number[]; parts: number[] } {
  const defs: number[] = [], parts: number[] = [];
  for (const defId of reader.ids('IFCMATERIALDEFINITIONREPRESENTATION')) {
    const def = reader.entity(defId);
    if (!def || asRef(def.attributes[3]) !== materialId) continue;
    defs.push(defId);
    for (const repId of refList(def.attributes[2])) parts.push(repId, ...refList(reader.entity(repId)?.attributes[3]));
  }
  return { defs, parts };
}

function styledItem(editor: StoreEditor, schema: string, styleId: number): number {
  const ref = schema === 'IFC2X3' ? editor.addEntity('IfcPresentationStyleAssignment', [[`#${styleId}`]]).expressId : styleId;
  return editor.addEntity('IfcStyledItem', [null, [`#${ref}`], null]).expressId;
}

/**
 * Give `materialId` this appearance, replacing whatever it had (its own
 * appearance records go; styles shared with other items stay). An empty
 * appearance just removes it.
 */
export function writeMaterialAppearance(
  store: IfcDataStore, editor: StoreEditor, materialId: number, name: string, appearance: MaterialAppearance,
): void {
  const reader = new AnchorEntityReader(store, editor.getMutationView());
  const bodyContextId = reader.contextId('body', reader.rootContextId());
  if (bodyContextId === null) throw new Error('The model has no representation context to hold a material appearance');
  const old = appearanceRecords(reader, materialId);
  for (const id of [...old.defs, ...old.parts]) if (!editor.getNewEntity(id)) editor.removeEntity(id);
  pruneOrphanOverlay(editor, old.defs.filter((id) => editor.getNewEntity(id)));

  emitMaterialAppearance(editor, String(store.schemaVersion ?? 'IFC4'), bodyContextId, materialId, name, appearance);
}

/** Write a fresh appearance for `materialId` (one that has none yet). */
export function emitMaterialAppearance(
  editor: StoreEditor, schemaVersion: string, bodyContextId: number, materialId: number, name: string, appearance: MaterialAppearance,
): void {
  const schema = schemaVersion.toUpperCase();
  const items: number[] = [];
  const surface = appearance.color ? rgb(appearance.color) : null;
  if (surface) {
    const style = emitSurfaceStyle(editor, schema, { ...surface, alpha: 1 - (appearance.transparency ?? 0) }, name).surfaceStyleId;
    items.push(styledItem(editor, schema, style));
  }
  for (const kind of MATERIAL_VIEW_KINDS) {
    const h = appearance.hatches?.[kind];
    if (!h || (!h.pattern && !h.background)) continue;
    const fills: string[] = [];
    const bg = h.background ? rgb(h.background) : null;
    if (bg) fills.push(`#${editor.addEntity('IfcColourRgb', [null, { real: bg.red }, { real: bg.green }, { real: bg.blue }]).expressId}`);
    if (h.pattern) {
      const label = h.scale && h.scale !== 1 ? `${h.pattern} x${h.scale}` : h.pattern;
      fills.push(`#${editor.addEntity('IfcExternallyDefinedHatchStyle', [HATCH_LOCATION, h.pattern, label]).expressId}`);
    }
    // IFC4 adds ModelOrDraughting: true, a drafting (not model-scaled) style.
    const attrs = schema === 'IFC2X3' ? [FILL_NAMES[kind], fills] : [FILL_NAMES[kind], fills, '.T.'];
    items.push(styledItem(editor, schema, editor.addEntity('IfcFillAreaStyle', attrs).expressId));
  }
  if (items.length === 0) return;
  const rep = editor.addEntity('IfcStyledRepresentation', [`#${bodyContextId}`, 'Style', 'Material', items.map((i) => `#${i}`)]).expressId;
  editor.addEntity('IfcMaterialDefinitionRepresentation', [null, null, [`#${rep}`], `#${materialId}`]);
}

/** The IfcMaterial ids named `name` (case- and space-insensitive). */
export function materialsNamed(store: IfcDataStore | null, view: MutablePropertyView | null | undefined, name: string): number[] {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const reader = new AnchorEntityReader(store, view);
  return [...reader.ids('IFCMATERIAL')].filter((id) => {
    const n = reader.entity(id)?.attributes[0];
    return typeof n === 'string' && n.trim().toLowerCase().replace(/\s+/g, ' ') === key;
  });
}

/**
 * The elements (and element types' occurrences) that show `materialIds`:
 * associated with one directly, or through a layer set (usage), a profile
 * set, a constituent set or a material list. What to remesh after their
 * colour changes.
 */
export function elementsWithMaterials(store: IfcDataStore | null, view: MutablePropertyView | null | undefined, materialIds: readonly number[]): number[] {
  const reader = new AnchorEntityReader(store, view);
  const target = new Set(materialIds);
  const memo = new Map<number, boolean>();
  const uses = (id: number | null, depth = 0): boolean => {
    if (id === null || depth > 4) return false;
    if (target.has(id)) return true;
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    memo.set(id, false);
    const e = reader.entity(id);
    if (!e) return false;
    const refs = e.attributes.flatMap((a) => (Array.isArray(a) ? refList(a) : [asRef(a)].filter((x): x is number => x !== null)));
    const result = refs.some((r) => uses(r, depth + 1));
    memo.set(id, result);
    return result;
  };
  const direct = new Set<number>();
  for (const relId of reader.ids('IFCRELASSOCIATESMATERIAL')) {
    const rel = reader.entity(relId);
    if (rel && uses(asRef(rel.attributes[5]))) for (const id of refList(rel.attributes[4])) direct.add(id);
  }
  // A type's material reaches its occurrences.
  for (const relId of reader.ids('IFCRELDEFINESBYTYPE')) {
    const rel = reader.entity(relId);
    if (rel && direct.has(asRef(rel.attributes[5]) ?? -1)) for (const id of refList(rel.attributes[4])) direct.add(id);
  }
  return [...direct];
}

/**
 * Each element's materials in order (its own association, else its type's):
 * a layer set's layers, a profile set's profiles, a constituent set's
 * constituents, a list's members, or the one material. Relationships are
 * read once for all of `elementIds`.
 */
export function materialIdsByElement(store: IfcDataStore | null, view: MutablePropertyView | null | undefined, elementIds: Iterable<number>): Map<number, number[]> {
  const reader = new AnchorEntityReader(store, view);
  const relating = new Map<number, number>();
  for (const relId of reader.ids('IFCRELASSOCIATESMATERIAL')) {
    const rel = reader.entity(relId);
    const target = rel ? asRef(rel.attributes[5]) : null;
    if (target !== null) for (const id of refList(rel!.attributes[4])) relating.set(id, target);
  }
  const typeOf = new Map<number, number>();
  for (const relId of reader.ids('IFCRELDEFINESBYTYPE')) {
    const rel = reader.entity(relId);
    const type = rel ? asRef(rel.attributes[5]) : null;
    if (type !== null) for (const id of refList(rel!.attributes[4])) typeOf.set(id, type);
  }
  const expand = (id: number, depth: number): number[] => {
    const e = depth > 4 ? null : reader.entity(id);
    if (!e) return [];
    switch (e.type.toUpperCase()) {
      case 'IFCMATERIAL': return [id];
      case 'IFCMATERIALLAYERSETUSAGE': case 'IFCMATERIALPROFILESETUSAGE': case 'IFCMATERIALPROFILESETUSAGETAPERING': {
        const set = asRef(e.attributes[0]);
        return set === null ? [] : expand(set, depth + 1);
      }
      case 'IFCMATERIALLAYERSET': case 'IFCMATERIALLIST': return refList(e.attributes[0]).flatMap((x) => expand(x, depth + 1));
      case 'IFCMATERIALPROFILESET': case 'IFCMATERIALCONSTITUENTSET': return refList(e.attributes[2]).flatMap((x) => expand(x, depth + 1));
      case 'IFCMATERIALLAYER': case 'IFCMATERIALPROFILE': case 'IFCMATERIALCONSTITUENT': {
        const m = asRef(e.attributes[e.type.toUpperCase() === 'IFCMATERIALLAYER' ? 0 : 2]);
        return m === null ? [] : expand(m, depth + 1);
      }
      default: return [];
    }
  };
  const out = new Map<number, number[]>();
  for (const id of elementIds) {
    const own = relating.get(id);
    const type = typeOf.get(id);
    const select = own ?? (type !== undefined ? relating.get(type) : undefined);
    if (select !== undefined) out.set(id, [...new Set(expand(select, 0))]);
  }
  return out;
}
