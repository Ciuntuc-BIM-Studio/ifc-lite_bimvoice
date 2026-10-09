/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Structure profiles for civil works — the cross-sections a corridor
 * sweeps besides its pavement: retaining walls, tunnel linings, bridge
 * decks, safety barriers, kerbs, lined ditches, or any drawn shape. A
 * profile is a closed outline (with holes) in its own frame: x across (away
 * from the road for a side element, to the right for a centred one), y up,
 * metres; the origin is the insertion point, set where the profile meets
 * the corridor (the finished-grade edge, the axis). Named anchors mark
 * other points to attach to (the wall's top, the deck's edge…).
 *
 * A profile made from a preset keeps its preset and parameters, so editing
 * a parameter regenerates its outline; a custom profile is edited point by
 * point. Each profile says which IFC class it is built as, per schema.
 */

export type P2 = [number, number];

export type StructureKind = 'retaining-wall' | 'tunnel' | 'bridge-deck' | 'abutment' | 'barrier' | 'kerb' | 'ditch' | 'custom';

export interface ProfileAnchor {
  name: string;
  at: P2;
}

export interface StructureProfile {
  id: string;
  name: string;
  kind: StructureKind;
  /** The preset it is generated from, with its parameters (metres); absent for a custom outline. */
  preset?: { id: PresetId; params: Record<string, number> };
  outer: P2[];
  holes: P2[][];
  anchors: ProfileAnchor[];
  material: string;
  /** CSS hex colour. */
  color: string;
  /** IFC class, predefined type and object type it is built as (IFC4X3 names; IFC4 falls back, see `profileIfcClass`). */
  ifcClass: string;
  predefinedType?: string;
  objectType?: string;
}

export type PresetId = 'cantilever-wall' | 'gravity-wall' | 'box-tunnel' | 'arch-tunnel' | 'deck-slab' | 'wall-abutment' | 'gravity-abutment' | 'concrete-barrier' | 'kerb' | 'lined-ditch';

export interface PresetParam {
  key: string;
  default: number;
  min: number;
}

interface PresetDef {
  kind: StructureKind;
  name: string;
  params: PresetParam[];
  material: string;
  color: string;
  ifcClass: string;
  predefinedType?: string;
  objectType?: string;
  build(p: Record<string, number>): Pick<StructureProfile, 'outer' | 'holes' | 'anchors'>;
}

const arc = (cx: number, cy: number, r: number, from: number, to: number, steps = 16): P2[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + (to - from) * (i / steps);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2;
  });

export const PROFILE_PRESETS: Readonly<Record<PresetId, PresetDef>> = {
  'cantilever-wall': {
    kind: 'retaining-wall', name: 'Cantilever retaining wall', material: 'Reinforced concrete', color: '#9ca3af',
    ifcClass: 'IfcWall', predefinedType: 'RETAININGWALL', objectType: 'Retaining wall',
    params: [
      { key: 'height', default: 3, min: 0.3 }, { key: 'stemTop', default: 0.25, min: 0.1 }, { key: 'stemBase', default: 0.4, min: 0.1 },
      { key: 'baseWidth', default: 2.2, min: 0.3 }, { key: 'baseThickness', default: 0.4, min: 0.1 }, { key: 'toe', default: 0.6, min: 0 },
    ],
    // Origin: the stem's front face (road side) on the footing's top; the soil is retained at +x.
    build: ({ height: H, stemTop: t1, stemBase: t2, baseWidth: B, baseThickness: tb, toe }) => ({
      outer: [[-toe, -tb], [B - toe, -tb], [B - toe, 0], [t2, 0], [t1, H], [0, H], [0, 0], [-toe, 0]],
      holes: [],
      anchors: [{ name: 'top', at: [0, H] }, { name: 'toe', at: [-toe, -tb] }, { name: 'heel', at: [B - toe, -tb] }],
    }),
  },
  'gravity-wall': {
    kind: 'retaining-wall', name: 'Gravity retaining wall', material: 'Mass concrete', color: '#a8a29e',
    ifcClass: 'IfcWall', predefinedType: 'RETAININGWALL', objectType: 'Retaining wall',
    params: [{ key: 'height', default: 2.5, min: 0.3 }, { key: 'topWidth', default: 0.5, min: 0.1 }, { key: 'baseWidth', default: 1.4, min: 0.2 }],
    build: ({ height: H, topWidth: a, baseWidth: b }) => ({
      outer: [[0, 0], [b, 0], [a, H], [0, H]],
      holes: [],
      anchors: [{ name: 'top', at: [0, H] }, { name: 'heel', at: [b, 0] }],
    }),
  },
  'box-tunnel': {
    kind: 'tunnel', name: 'Box tunnel', material: 'Reinforced concrete', color: '#94a3b8',
    ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: 'Tunnel lining',
    params: [{ key: 'width', default: 10, min: 1 }, { key: 'height', default: 5.5, min: 1 }, { key: 'wall', default: 0.6, min: 0.1 }, { key: 'slab', default: 0.8, min: 0.1 }],
    // Origin: the road axis on the invert (inside floor).
    build: ({ width: W, height: H, wall: t, slab: s }) => ({
      outer: [[-W / 2 - t, -s], [W / 2 + t, -s], [W / 2 + t, H + s], [-W / 2 - t, H + s]],
      holes: [[[-W / 2, 0], [-W / 2, H], [W / 2, H], [W / 2, 0]]],
      anchors: [{ name: 'crown', at: [0, H + s] }, { name: 'left', at: [-W / 2, 0] }, { name: 'right', at: [W / 2, 0] }],
    }),
  },
  'arch-tunnel': {
    kind: 'tunnel', name: 'Arch tunnel', material: 'Shotcrete lining', color: '#94a3b8',
    ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: 'Tunnel lining',
    params: [{ key: 'width', default: 10, min: 1 }, { key: 'wallHeight', default: 2.5, min: 0 }, { key: 'lining', default: 0.4, min: 0.05 }, { key: 'invert', default: 0.6, min: 0.05 }],
    build: ({ width: W, wallHeight: h, lining: t, invert: s }) => {
      const r = W / 2;
      const inner = [[r, 0] as P2, ...arc(0, h, r, 0, Math.PI), [-r, 0] as P2];
      const outer = [[-(r + t), -s] as P2, [r + t, -s] as P2, ...arc(0, h, r + t, 0, Math.PI)];
      // Inner loop clockwise against the outer's counter-clockwise.
      return { outer, holes: [inner.reverse()], anchors: [{ name: 'crown', at: [0, h + r + t] }, { name: 'left', at: [-r, 0] }, { name: 'right', at: [r, 0] }] };
    },
  },
  'deck-slab': {
    kind: 'bridge-deck', name: 'Bridge deck slab', material: 'Reinforced concrete', color: '#cbd5e1',
    ifcClass: 'IfcSlab', predefinedType: 'USERDEFINED', objectType: 'Bridge deck',
    params: [{ key: 'width', default: 11, min: 1 }, { key: 'depth', default: 1.2, min: 0.2 }, { key: 'cantilever', default: 2, min: 0 }, { key: 'tip', default: 0.25, min: 0.1 }],
    // Origin: the deck's top on the road axis.
    build: ({ width: W, depth: D, cantilever: c, tip }) => {
      const w = W / 2, web = Math.max(w - c, 0.2);
      return {
        outer: [[-w, 0], [-w, -tip], [-web, -Math.min(D, tip + 0.15)], [-web, -D], [web, -D], [web, -Math.min(D, tip + 0.15)], [w, -tip], [w, 0]].reverse() as P2[],
        holes: [],
        anchors: [{ name: 'leftEdge', at: [-w, 0] }, { name: 'rightEdge', at: [w, 0] }, { name: 'soffit', at: [0, -D] }],
      };
    },
  },
  // Abutments: origin on the front face at the bearing seat (the deck's soffit); x back into the
  // embankment, y up. In a bridge the height reaches down to the footing and the back wall up to the
  // deck's top (`bridge.ts`).
  'wall-abutment': {
    kind: 'abutment', name: 'Wall abutment', material: 'Reinforced concrete', color: '#a8a29e',
    ifcClass: 'IfcWall', predefinedType: 'USERDEFINED', objectType: 'Abutment',
    params: [{ key: 'height', default: 6, min: 0.5 }, { key: 'stem', default: 1, min: 0.2 }, { key: 'backwall', default: 0.4, min: 0.15 }, { key: 'backwallHeight', default: 1.2, min: 0.3 }],
    build: ({ height: H, stem: t, backwall, backwallHeight: hb }) => {
      const tb = Math.min(backwall, t);
      return { outer: [[0, -H], [t, -H], [t, hb], [t - tb, hb], [t - tb, 0], [0, 0]], holes: [], anchors: [{ name: 'seat', at: [0, 0] }, { name: 'top', at: [t, hb] }] };
    },
  },
  'gravity-abutment': {
    kind: 'abutment', name: 'Gravity abutment', material: 'Mass concrete', color: '#a8a29e',
    ifcClass: 'IfcWall', predefinedType: 'USERDEFINED', objectType: 'Abutment',
    params: [{ key: 'height', default: 6, min: 0.5 }, { key: 'stem', default: 1.2, min: 0.2 }, { key: 'base', default: 3, min: 0.2 }, { key: 'backwall', default: 0.4, min: 0.15 }, { key: 'backwallHeight', default: 1.2, min: 0.3 }],
    build: ({ height: H, stem: t, base, backwall, backwallHeight: hb }) => {
      const tb = Math.min(backwall, t), b = Math.max(base, t);
      return { outer: [[0, -H], [b, -H], [t, 0], [t, hb], [t - tb, hb], [t - tb, 0], [0, 0]], holes: [], anchors: [{ name: 'seat', at: [0, 0] }, { name: 'top', at: [t, hb] }] };
    },
  },
  'concrete-barrier': {
    kind: 'barrier', name: 'Concrete safety barrier', material: 'Precast concrete', color: '#d4d4d8',
    ifcClass: 'IfcRailing', predefinedType: 'GUARDRAIL', objectType: 'Safety barrier',
    params: [{ key: 'height', default: 0.81, min: 0.3 }, { key: 'base', default: 0.6, min: 0.2 }, { key: 'top', default: 0.15, min: 0.05 }],
    // Origin: the road-side foot of the barrier.
    build: ({ height: H, base: b, top: a }) => {
      const kink = Math.min(0.33, H * 0.4), mid = (b - a) / 2;
      return {
        outer: [[0, 0], [b, 0], [b, 0.075], [b - mid * 0.25, kink], [b - mid, H], [mid, H], [mid * 0.25, kink], [0, 0.075]],
        holes: [],
        anchors: [{ name: 'top', at: [b / 2, H] }],
      };
    },
  },
  kerb: {
    kind: 'kerb', name: 'Kerb', material: 'Precast concrete', color: '#e4e4e7',
    ifcClass: 'IfcKerb', objectType: 'Kerb',
    params: [{ key: 'width', default: 0.15, min: 0.05 }, { key: 'upstand', default: 0.15, min: 0 }, { key: 'depth', default: 0.3, min: 0.05 }],
    // Origin: the kerb's face at the road surface.
    build: ({ width: w, upstand: u, depth: d }) => ({
      outer: [[0, -(d - u)], [w, -(d - u)], [w, u], [0.03, u], [0, u - 0.03]],
      holes: [],
      anchors: [{ name: 'top', at: [w / 2, u] }],
    }),
  },
  'lined-ditch': {
    kind: 'ditch', name: 'Lined ditch', material: 'Concrete lining', color: '#a1a1aa',
    ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: 'Ditch lining',
    params: [{ key: 'depth', default: 0.6, min: 0.1 }, { key: 'bottom', default: 0.5, min: 0 }, { key: 'slope', default: 1, min: 0 }, { key: 'lining', default: 0.12, min: 0.03 }],
    // Origin: the ditch's road-side lip.
    build: ({ depth: d, bottom: b, slope: s, lining: t }) => {
      const x1 = s * d, x2 = x1 + b, x3 = x2 + s * d;
      const k = t * Math.sqrt(1 + s * s);
      return {
        outer: [[0, 0], [x1, -d], [x2, -d], [x3, 0], [x3 + k, 0], [x2 + k * s / (1 + s) + t * 0.2, -d - t], [x1 - t * 0.2 - k * s / (1 + s), -d - t], [-k, 0]].reverse() as P2[],
        holes: [],
        anchors: [{ name: 'invert', at: [(x1 + x2) / 2, -d] }, { name: 'farLip', at: [x3, 0] }],
      };
    },
  },
};

export const PRESET_IDS = Object.keys(PROFILE_PRESETS) as PresetId[];

export function presetParams(id: PresetId): Record<string, number> {
  return Object.fromEntries(PROFILE_PRESETS[id].params.map((p) => [p.key, p.default]));
}

/** A profile's outline regenerated from its preset parameters (unchanged for a custom one). */
export function regenerateProfile(p: StructureProfile): StructureProfile {
  if (!p.preset) return p;
  const def = PROFILE_PRESETS[p.preset.id];
  const params = { ...presetParams(p.preset.id), ...p.preset.params };
  for (const q of def.params) params[q.key] = Math.max(q.min, Number.isFinite(params[q.key]) ? params[q.key] : q.default);
  const built = def.build(params);
  return { ...p, preset: { id: p.preset.id, params }, outer: orient(built.outer, 1), holes: built.holes.map((h) => orient(h, -1)), anchors: built.anchors };
}

/** A new profile from a preset, its defaults. */
export function profileFromPreset(id: PresetId, profileId: string, name?: string): StructureProfile {
  const def = PROFILE_PRESETS[id];
  return regenerateProfile({
    id: profileId, name: name ?? def.name, kind: def.kind, preset: { id, params: presetParams(id) },
    outer: [], holes: [], anchors: [], material: def.material, color: def.color,
    ifcClass: def.ifcClass, predefinedType: def.predefinedType, objectType: def.objectType,
  });
}

/** The starter library: one profile per preset. */
export function starterProfiles(): StructureProfile[] {
  return PRESET_IDS.map((id) => profileFromPreset(id, `starter-${id}`));
}

/** Detach a profile from its preset: its outline is now edited point by point. */
export function toCustomProfile(p: StructureProfile): StructureProfile {
  const out: StructureProfile = { ...p };
  delete out.preset;
  return out;
}

export function signedArea(loop: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The loop counter-clockwise (+1) or clockwise (-1). */
export function orient(loop: readonly P2[], sense: 1 | -1): P2[] {
  const copy = loop.map((p) => [p[0], p[1]] as P2);
  return Math.sign(signedArea(copy)) === sense || signedArea(copy) === 0 ? copy : copy.reverse();
}

/** Net area, m². */
export function profileArea(p: Pick<StructureProfile, 'outer' | 'holes'>): number {
  return Math.abs(signedArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
}

export function profileBounds(p: Pick<StructureProfile, 'outer'>): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = p.outer.map((q) => q[0]), ys = p.outer.map((q) => q[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function selfCrosses(loop: readonly P2[]): boolean {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(loop[i], loop[(i + 1) % n], loop[j], loop[(j + 1) % n])) return true;
    }
  }
  return false;
}

function inside(p: P2, loop: readonly P2[]): boolean {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** Why a profile cannot be swept, or null. */
export function structureProfileProblem(p: Pick<StructureProfile, 'outer' | 'holes' | 'name'>): string | null {
  if (!p.name.trim()) return 'The profile needs a name';
  if (p.outer.length < 3) return 'The outline needs at least three points';
  if (p.outer.some((q) => !q.every(Number.isFinite))) return 'A point is not a number';
  if (selfCrosses(p.outer)) return 'The outline crosses itself';
  if (Math.abs(signedArea(p.outer)) < 1e-6) return 'The outline has no area';
  for (const h of p.holes) {
    if (h.length < 3 || selfCrosses(h)) return 'A hole is not a simple loop';
    if (!h.every((q) => inside(q, p.outer))) return 'A hole runs outside the outline';
  }
  return null;
}

/** The class a profile is built as in a schema: IFC4X3-only classes and types fall back in IFC4. */
export function profileIfcClass(p: Pick<StructureProfile, 'ifcClass' | 'predefinedType' | 'objectType'>, schema: string): { ifcClass: string; predefinedType?: string; objectType?: string } {
  if (schema === 'IFC4X3') return { ifcClass: p.ifcClass, predefinedType: p.predefinedType, objectType: p.objectType };
  if (p.ifcClass === 'IfcKerb') return { ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: p.objectType ?? 'Kerb' };
  if (p.ifcClass === 'IfcWall' && p.predefinedType === 'RETAININGWALL') return { ifcClass: 'IfcWall', predefinedType: 'USERDEFINED', objectType: p.objectType ?? 'Retaining wall' };
  if (p.ifcClass === 'IfcRailing' && p.predefinedType === 'GUARDRAIL') return { ifcClass: 'IfcRailing', predefinedType: 'GUARDRAIL', objectType: p.objectType };
  return { ifcClass: p.ifcClass, predefinedType: p.predefinedType, objectType: p.objectType };
}

// --- persistence -------------------------------------------------------------

export const PROFILE_LIBRARY_FORMAT = 'ifc-lite-structure-profiles';
export const PROFILE_LIBRARY_VERSION = 1;
const KINDS: readonly StructureKind[] = ['retaining-wall', 'tunnel', 'bridge-deck', 'abutment', 'barrier', 'kerb', 'ditch', 'custom'];
const HEX = /^#[0-9a-f]{6}$/i;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const point = (v: unknown): P2 | null => (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1])) ? [Number(v[0]), Number(v[1])] : null);
const loop = (v: unknown): P2[] => (Array.isArray(v) ? v.map(point).filter((p): p is P2 => p !== null) : []);

/** A profile read from untrusted JSON (a project or library file), or null when it is not one. */
export function readStructureProfile(raw: unknown): StructureProfile | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const kind = KINDS.includes(raw.kind as StructureKind) ? raw.kind as StructureKind : 'custom';
  let preset: StructureProfile['preset'];
  if (isObject(raw.preset) && typeof raw.preset.id === 'string' && raw.preset.id in PROFILE_PRESETS) {
    const params: Record<string, number> = {};
    if (isObject(raw.preset.params)) for (const [k, v] of Object.entries(raw.preset.params)) if (Number.isFinite(Number(v))) params[k] = Number(v);
    preset = { id: raw.preset.id as PresetId, params };
  }
  const base: StructureProfile = {
    id: raw.id, name: raw.name, kind, preset,
    outer: loop(raw.outer), holes: Array.isArray(raw.holes) ? raw.holes.map(loop).filter((h) => h.length >= 3) : [],
    anchors: Array.isArray(raw.anchors) ? raw.anchors.flatMap((a) => (isObject(a) && typeof a.name === 'string' && point(a.at) ? [{ name: a.name, at: point(a.at)! }] : [])) : [],
    material: typeof raw.material === 'string' ? raw.material : '',
    color: typeof raw.color === 'string' && HEX.test(raw.color) ? raw.color : '#a1a1aa',
    ifcClass: typeof raw.ifcClass === 'string' && /^Ifc[A-Za-z]+$/.test(raw.ifcClass) ? raw.ifcClass : 'IfcBuildingElementProxy',
    predefinedType: typeof raw.predefinedType === 'string' ? raw.predefinedType : undefined,
    objectType: typeof raw.objectType === 'string' ? raw.objectType : undefined,
  };
  const out = preset ? regenerateProfile(base) : base;
  return out.outer.length >= 3 ? out : null;
}

export function readStructureProfileList(raw: unknown): StructureProfile[] {
  return Array.isArray(raw) ? raw.map(readStructureProfile).filter((p): p is StructureProfile => p !== null) : [];
}

/** Profiles of a library file (`{ format, version, profiles }`) or of a bare array. */
export function readProfileLibrary(text: string): StructureProfile[] {
  const raw = JSON.parse(text) as unknown;
  if (Array.isArray(raw)) return readStructureProfileList(raw);
  if (isObject(raw) && raw.format === PROFILE_LIBRARY_FORMAT) return readStructureProfileList(raw.profiles);
  throw new Error('Not a structure profile library');
}

export function writeProfileLibrary(profiles: readonly StructureProfile[]): string {
  return JSON.stringify({ format: PROFILE_LIBRARY_FORMAT, version: PROFILE_LIBRARY_VERSION, profiles }, null, 2);
}
