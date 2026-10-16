/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's element types (walls, slabs, columns, beams, roofs,
 * openings, curtain walls, strip foundations, pad footings): what each kind's entry describes, its defaults, and a tolerant
 * reader for project files and imported catalogues (a field that does not
 * read falls back to the kind's default; an entry with no kind is dropped).
 *
 * Doors and windows have their own catalogue (`joinery/`); these entries
 * become IFC type objects the same way (`model-sync.ts`).
 */

import {
  DEFAULT_CURTAIN_WALL_TYPE, DEFAULT_PAD_FOOTING, DEFAULT_STRIP_FOUNDATION, defaultRoofStructure,
  type CurtainWallTypeSpec, type PadStep, type ProfileSection, type RoofStructureSpec,
} from '@ifc-lite/create';
import { DEFAULT_SECTIONS } from '@/lib/profile-section/profile-kinds';

export type ElementTypeKind = 'wall' | 'slab' | 'column' | 'beam' | 'roof' | 'opening' | 'curtainWall' | 'stripFoundation' | 'padFooting';
export const ELEMENT_TYPE_KINDS: readonly ElementTypeKind[] = ['wall', 'slab', 'column', 'beam', 'roof', 'opening', 'curtainWall', 'stripFoundation', 'padFooting'];

export interface TypeLayer {
  name: string;
  /** Metres. */
  thickness: number;
  /** #rrggbb. */
  color?: string;
  /** A foundation wall's structural core, which carries its axis. */
  core?: boolean;
}

interface TypeBase {
  id: string;
  name: string;
  mark: string;
}

/** Layers from the face right of the drawn direction to the left one (Flip Y swaps them); the wall is as thick as they are together. */
export interface WallTypeSpec extends TypeBase { kind: 'wall'; layers: TypeLayer[]; height: number }
/** Layers top to bottom. */
export interface SlabTypeSpec extends TypeBase { kind: 'slab'; layers: TypeLayer[] }
export interface ColumnTypeSpec extends TypeBase { kind: 'column'; section: ProfileSection; height: number }
export interface BeamTypeSpec extends TypeBase { kind: 'beam'; section: ProfileSection }
/** A roof system preset: covering build-up (outermost first) and structure; pitch and overhang for new roofs. */
export interface RoofTypeSpec extends TypeBase {
  kind: 'roof';
  shape: 'hip' | 'gable' | 'mono';
  pitch: number;
  overhang: number;
  layers: TypeLayer[];
  color: string;
  timberColor: string;
  structure: RoofStructureSpec;
}
export interface OpeningTypeSpec extends TypeBase { kind: 'opening'; width: number; height: number; sill: number }
/** A curtain wall type: its grid, sections, panels and colours (`curtain`); the height new curtain walls of it take. Each curtain wall keeps its own line and height. */
export interface CurtainWallElementTypeSpec extends TypeBase { kind: 'curtainWall'; height: number; curtain: CurtainWallTypeSpec }

/**
 * A strip foundation: the foundation wall's layers (as a wall's, one of them
 * the core on the axis), its height on the footing, the footing's width and
 * height, and the footing's underside below the storey (negative).
 */
export interface StripFoundationTypeSpec extends TypeBase {
  kind: 'stripFoundation';
  layers: TypeLayer[];
  stemHeight: number;
  footingWidth: number;
  footingHeight: number;
  bottom: number;
}
/** A stepped pad footing: its steps from the bottom up, and its underside below the storey. */
export interface PadFootingTypeSpec extends TypeBase { kind: 'padFooting'; steps: PadStep[]; bottom: number }

export type ElementTypeSpec = WallTypeSpec | SlabTypeSpec | ColumnTypeSpec | BeamTypeSpec | RoofTypeSpec | OpeningTypeSpec | CurtainWallElementTypeSpec
  | StripFoundationTypeSpec | PadFootingTypeSpec;

/**
 * The IFC type class an entry is written as. A roof system names its entry in its own spec; an opening has no type class;
 * a foundation writes its own types (`foundation-element.ts`).
 */
export const TYPE_CLASS: Readonly<Record<ElementTypeKind, string | null>> = {
  wall: 'IfcWallType', slab: 'IfcSlabType', column: 'IfcColumnType', beam: 'IfcBeamType', roof: null, opening: null, curtainWall: null,
  stripFoundation: null, padFooting: null,
};

export const MARK_PREFIX: Readonly<Record<ElementTypeKind, string>> = { wall: 'WT', slab: 'ST', column: 'C', beam: 'B', roof: 'R', opening: 'O', curtainWall: 'CW', stripFoundation: 'SF', padFooting: 'PF' };

export const layersThickness = (layers: readonly TypeLayer[]) => layers.reduce((s, l) => s + l.thickness, 0);

/** An entry without its identity: what a new entry of a kind starts as. */
export type ElementTypeBody = ElementTypeSpec extends infer T ? T extends ElementTypeSpec ? Omit<T, 'id' | 'name' | 'mark'> : never : never;

export function defaultTypeSpec(kind: ElementTypeKind): ElementTypeBody {
  switch (kind) {
    case 'wall': return { kind, height: 3, layers: [
      { name: 'Render', thickness: 0.02, color: '#e8e2d6' }, { name: 'Brick', thickness: 0.25, color: '#b5651d' }, { name: 'Plaster', thickness: 0.015, color: '#f2f0ea' },
    ] };
    case 'slab': return { kind, layers: [
      { name: 'Screed', thickness: 0.05, color: '#c9c3b6' }, { name: 'Concrete', thickness: 0.2, color: '#a8a8a8' },
    ] };
    case 'column': return { kind, section: { Type: 'Rectangle', XDim: 0.4, YDim: 0.4 }, height: 3 };
    case 'beam': return { kind, section: { Type: 'Rectangle', XDim: 0.3, YDim: 0.5 } };
    case 'roof': return {
      kind, shape: 'gable', pitch: 35, overhang: 0.5, color: '#8b4a3a', timberColor: '#c8a070', structure: defaultRoofStructure(),
      layers: [{ name: 'Roof tiles', thickness: 0.04, color: '#8b4a3a' }, { name: 'Underlay membrane', thickness: 0.002, color: '#4a4a4a' }],
    };
    case 'opening': return { kind, width: 1, height: 1, sill: 1 };
    case 'curtainWall': return { kind, height: 3, curtain: structuredClone(DEFAULT_CURTAIN_WALL_TYPE) };
    case 'stripFoundation': {
      const { layers, stemHeight, footingWidth, footingHeight, bottom } = DEFAULT_STRIP_FOUNDATION;
      return { kind, layers: layers.map((l) => ({ ...l })), stemHeight, footingWidth, footingHeight, bottom };
    }
    case 'padFooting': return { kind, steps: DEFAULT_PAD_FOOTING.steps.map((s) => ({ ...s })), bottom: DEFAULT_PAD_FOOTING.bottom };
  }
}

// ---------------------------------------------------------------- reading

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback);
const signed = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function readSteps(v: unknown, fallback: PadStep[]): PadStep[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.flatMap((s): PadStep[] => (isObject(s) && [s.length, s.width, s.height].every((x) => typeof x === 'number' && x > 0)
    ? [{ length: s.length as number, width: s.width as number, height: s.height as number }] : []));
  return out.length ? out : fallback;
}
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const hex = (v: unknown): string | undefined => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

function readLayers(v: unknown, fallback: TypeLayer[]): TypeLayer[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.flatMap((l): TypeLayer[] => {
    if (!isObject(l) || !(typeof l.thickness === 'number' && l.thickness > 0)) return [];
    const color = hex(l.color);
    return [{ name: str(l.name, 'Layer') || 'Layer', thickness: l.thickness, ...(color ? { color } : {}), ...(l.core === true ? { core: true } : {}) }];
  });
  return out.length ? out : fallback;
}

function readSection(v: unknown, fallback: ProfileSection): ProfileSection {
  if (!isObject(v) || typeof v.Type !== 'string') return fallback;
  const base = v.Type === 'Rectangle' ? { Type: 'Rectangle', XDim: 0.3, YDim: 0.3 } : DEFAULT_SECTIONS[v.Type as Exclude<ProfileSection['Type'], 'Rectangle'>];
  if (!base) return fallback;
  const out: Record<string, unknown> = { ...base };
  for (const [k, value] of Object.entries(v)) if (k !== 'Type' && typeof value === 'number' && value > 0) out[k] = value;
  return out as unknown as ProfileSection;
}

export function readElementTypeSpec(raw: unknown): ElementTypeSpec | null {
  if (!isObject(raw) || !ELEMENT_TYPE_KINDS.includes(raw.kind as ElementTypeKind)) return null;
  const kind = raw.kind as ElementTypeKind;
  const d = defaultTypeSpec(kind);
  const base = { id: str(raw.id, ''), name: str(raw.name, 'Type') || 'Type', mark: str(raw.mark, '') };
  if (!base.id) return null;
  switch (d.kind) {
    case 'wall': return { ...base, kind: 'wall', layers: readLayers(raw.layers, d.layers), height: num(raw.height, d.height, 0.01) };
    case 'slab': return { ...base, kind: 'slab', layers: readLayers(raw.layers, d.layers) };
    case 'column': return { ...base, kind: 'column', section: readSection(raw.section, d.section), height: num(raw.height, d.height, 0.01) };
    case 'beam': return { ...base, kind: 'beam', section: readSection(raw.section, d.section) };
    case 'roof': {
      const shape = raw.shape === 'hip' || raw.shape === 'mono' || raw.shape === 'gable' ? raw.shape : d.shape;
      // The structure is the roof configurator's: kept as written, over the defaults for anything missing.
      const structure = isObject(raw.structure) ? { ...d.structure, ...(raw.structure as Partial<RoofStructureSpec>) } : d.structure;
      return {
        ...base, kind: 'roof', shape, pitch: num(raw.pitch, d.pitch), overhang: num(raw.overhang, d.overhang), layers: readLayers(raw.layers, d.layers),
        color: hex(raw.color) ?? d.color, timberColor: hex(raw.timberColor) ?? d.timberColor, structure,
      };
    }
    case 'opening': return { ...base, kind: 'opening', width: num(raw.width, d.width, 0.01), height: num(raw.height, d.height, 0.01), sill: num(raw.sill, d.sill) };
    // The curtain wall configurator's own fields: kept as written, over the defaults for anything missing.
    case 'curtainWall': return { ...base, kind: 'curtainWall', height: num(raw.height, d.height, 0.01), curtain: isObject(raw.curtain) ? { ...d.curtain, ...(raw.curtain as Partial<CurtainWallTypeSpec>) } : d.curtain };
    case 'stripFoundation': return {
      ...base, kind: 'stripFoundation', layers: readLayers(raw.layers, d.layers), stemHeight: num(raw.stemHeight, d.stemHeight, 0.01),
      footingWidth: num(raw.footingWidth, d.footingWidth, 0.01), footingHeight: num(raw.footingHeight, d.footingHeight, 0.01), bottom: signed(raw.bottom, d.bottom),
    };
    case 'padFooting': return { ...base, kind: 'padFooting', steps: readSteps(raw.steps, d.steps), bottom: signed(raw.bottom, d.bottom) };
  }
}

export function readElementTypeList(raw: unknown): ElementTypeSpec[] {
  return Array.isArray(raw) ? raw.map(readElementTypeSpec).filter((s): s is ElementTypeSpec => s !== null) : [];
}

export function readCurrentTypes(raw: unknown): Partial<Record<ElementTypeKind, string>> {
  if (!isObject(raw)) return {};
  const out: Partial<Record<ElementTypeKind, string>> = {};
  for (const kind of ELEMENT_TYPE_KINDS) if (typeof raw[kind] === 'string') out[kind] = raw[kind] as string;
  return out;
}

export const ELEMENT_TYPE_CATALOGUE_FORMAT = 'ifc-lite-element-types';
export const ELEMENT_TYPE_CATALOGUE_VERSION = 1;

/** Entries of an exported catalogue file (`{ format, version, types }`), or of a bare array. */
export function readElementTypeCatalogue(text: string): ElementTypeSpec[] {
  const raw = JSON.parse(text) as unknown;
  if (Array.isArray(raw)) return readElementTypeList(raw);
  if (isObject(raw) && raw.format === ELEMENT_TYPE_CATALOGUE_FORMAT) return readElementTypeList(raw.types);
  throw new Error('Not an element type catalogue');
}
