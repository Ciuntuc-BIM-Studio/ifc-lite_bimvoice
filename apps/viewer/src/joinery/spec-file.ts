/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading joinery specs from a project file or an imported catalogue,
 * tolerantly: every field falls back to the kind's default, unknown
 * operations become fixed glazing, an entry that is not an object (or names
 * no kind) is dropped. A catalogue file is `{ format, version, types: [...] }`.
 */

import {
  DOOR_OPERATIONS, WINDOW_OPERATIONS, defaultDoorSpec, defaultWindowSpec,
  type JoineryPanel, type JoinerySpec, type PanelOperation,
} from '@ifc-lite/create';

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
const OPERATIONS = new Set<string>([...WINDOW_OPERATIONS, ...DOOR_OPERATIONS]);

export const JOINERY_CATALOGUE_FORMAT = 'ifc-lite-joinery-catalogue';
export const JOINERY_CATALOGUE_VERSION = 1;

function weights(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((w): w is number => typeof w === 'number' && Number.isFinite(w) && w > 0).slice(0, 12);
  return out.length ? out : fallback;
}

function panel(v: unknown): JoineryPanel | null {
  if (!isObject(v)) return null;
  const op = OPERATIONS.has(String(v.operation)) ? (v.operation as PanelOperation) : 'fixed';
  const out: JoineryPanel = { col: Math.round(num(v.col, 0)), row: Math.round(num(v.row, 0)), operation: op };
  if (typeof v.colSpan === 'number') out.colSpan = Math.max(1, Math.round(v.colSpan));
  if (typeof v.rowSpan === 'number') out.rowSpan = Math.max(1, Math.round(v.rowSpan));
  if (v.glazed === true) out.glazed = true;
  return out;
}

export function readJoinerySpec(raw: unknown): JoinerySpec | null {
  if (!isObject(raw) || (raw.kind !== 'door' && raw.kind !== 'window')) return null;
  const d = raw.kind === 'door' ? defaultDoorSpec() : defaultWindowSpec();
  const f = isObject(raw.frame) ? raw.frame : {};
  const s = isObject(raw.sash) ? raw.sash : {};
  const b = isObject(raw.board) ? raw.board : {};
  const c = isObject(raw.colors) ? raw.colors : {};
  const p = isObject(raw.props) ? raw.props : {};
  const spec: JoinerySpec = {
    kind: raw.kind,
    name: str(raw.name, d.name) || d.name,
    mark: str(raw.mark, d.mark),
    width: num(raw.width, d.width, 0.05), height: num(raw.height, d.height, 0.05), sillHeight: num(raw.sillHeight, d.sillHeight),
    frame: {
      depth: num(f.depth, d.frame.depth, 0.001), width: num(f.width, d.frame.width, 0.001),
      mullion: num(f.mullion, d.frame.mullion), transom: num(f.transom, d.frame.transom),
      offset: typeof f.offset === 'number' && Number.isFinite(f.offset) ? f.offset : d.frame.offset,
    },
    sash: {
      width: num(s.width, d.sash.width), depth: num(s.depth, d.sash.depth, 0.001),
      leafThickness: num(s.leafThickness, d.sash.leafThickness, 0.001), glassThickness: num(s.glassThickness, d.sash.glassThickness, 0.001),
    },
    columns: weights(raw.columns, d.columns), rows: weights(raw.rows, d.rows),
    panels: Array.isArray(raw.panels) ? raw.panels.map(panel).filter((x): x is JoineryPanel => x !== null) : d.panels,
    board: { interior: num(b.interior, d.board.interior), exterior: num(b.exterior, d.board.exterior) },
    threshold: num(raw.threshold, d.threshold),
    colors: { frame: hex(c.frame, d.colors.frame), glass: hex(c.glass, d.colors.glass), leaf: hex(c.leaf, d.colors.leaf) },
    props: {
      isExternal: typeof p.isExternal === 'boolean' ? p.isExternal : d.props.isExternal,
      ...(typeof p.thermalTransmittance === 'number' && Number.isFinite(p.thermalTransmittance) ? { thermalTransmittance: p.thermalTransmittance } : {}),
      ...(typeof p.fireRating === 'string' && p.fireRating ? { fireRating: p.fireRating } : {}),
      ...(typeof p.acousticRating === 'string' && p.acousticRating ? { acousticRating: p.acousticRating } : {}),
      ...(typeof p.securityRating === 'string' && p.securityRating ? { securityRating: p.securityRating } : {}),
      ...(typeof p.reference === 'string' && p.reference ? { reference: p.reference } : {}),
    },
  };
  if (typeof raw.id === 'string' && raw.id) spec.id = raw.id;
  return spec;
}

export function readJoineryList(raw: unknown): JoinerySpec[] {
  return Array.isArray(raw) ? raw.map(readJoinerySpec).filter((s): s is JoinerySpec => s !== null) : [];
}

export function joineryCatalogueText(specs: readonly JoinerySpec[]): string {
  return JSON.stringify({ format: JOINERY_CATALOGUE_FORMAT, version: JOINERY_CATALOGUE_VERSION, types: specs }, null, 2);
}

/** The types of a catalogue file (or a bare array of specs). */
export function parseJoineryCatalogue(text: string): JoinerySpec[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not a joinery catalogue: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (Array.isArray(raw)) return readJoineryList(raw);
  if (isObject(raw) && raw.format === JOINERY_CATALOGUE_FORMAT) return readJoineryList(raw.types);
  throw new Error(`Not a joinery catalogue: expected "format": "${JOINERY_CATALOGUE_FORMAT}"`);
}
