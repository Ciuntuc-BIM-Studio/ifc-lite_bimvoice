/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The `.ifclite-project.json` sidecar: a project's views and sheets, saved
 * next to the IFC files it refers to (by content hash, else by name). The
 * IFC files themselves are never written. Parsing validates every view so a
 * hand-edited or truncated file fails loudly instead of half-loading.
 */

import { downloadFile, sanitizeFilename } from '@/lib/export/download.js';
import { readDraft, readDraftLayer } from '@/drafting/draft-file';
import { readSheetLayout } from './sheet-file';
import { readStandards } from './standards-file';
import { readJoineryList } from '@/joinery/spec-file';
import { readCurrentTypes, readElementTypeList } from '@/element-types/spec';
import { readStructureProfileList } from '@ifc-lite/create';
import type { ProjectCivilDrawing, ProjectMaterial, ProjectTypicalSection, CategoryGraphics, ElevationDirection, ProjectDocument, ProjectLevel, ProjectModelRef, ProjectSchedule, ProjectSheet, ProjectView, ProjectViewKind, ViewGraphics } from './types';

export const PROJECT_FILE_SUFFIX = '.ifclite-project.json';
export const PROJECT_FILE_FORMAT = 'ifclite-project';
export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile extends ProjectDocument {
  format: typeof PROJECT_FILE_FORMAT;
  version: typeof PROJECT_FILE_VERSION;
  savedAt: string;
}

export function serializeProject(doc: ProjectDocument, now = new Date()): string {
  const file: ProjectFile = { format: PROJECT_FILE_FORMAT, version: PROJECT_FILE_VERSION, savedAt: now.toISOString(), ...doc };
  return JSON.stringify(file, null, 2);
}

export function exportProjectFile(doc: ProjectDocument): void {
  const stem = sanitizeFilename(doc.name, { fallback: 'project' });
  downloadFile(serializeProject(doc), `${stem}${PROJECT_FILE_SUFFIX}`, 'application/json');
}

const VIEW_KINDS: readonly ProjectViewKind[] = ['plan', 'section', 'elevation', '3d'];
const DIRECTIONS: readonly ElevationDirection[] = ['north', 'south', 'east', 'west'];
const AXES = ['down', 'front', 'side'] as const;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function fail(path: string, message: string): never {
  throw new Error(`Not a project file: ${path} ${message}`);
}

function readLevel(v: unknown, path: string): ProjectLevel {
  if (!isObject(v) || !isString(v.name) || !isNumber(v.elevation)) fail(path, 'must be a level { name, elevation }');
  const ids = Array.isArray(v.storeyGlobalIds) ? v.storeyGlobalIds.filter(isString) : [];
  return { name: v.name, elevation: v.elevation, storeyGlobalIds: ids };
}

function readView(v: unknown, path: string): ProjectView {
  if (!isObject(v) || !isString(v.id) || !isString(v.name)) fail(path, 'must have a string id and name');
  if (!VIEW_KINDS.includes(v.kind as ProjectViewKind)) fail(`${path}.kind`, `must be one of ${VIEW_KINDS.join(', ')}`);
  const base = {
    id: v.id, name: v.name, auto: v.auto === true, createdAt: isNumber(v.createdAt) ? v.createdAt : 0,
    ...(isNumber(v.viewDepth) && v.viewDepth >= 0 ? { viewDepth: v.viewDepth } : {}),
    ...(isObject(v.graphics) ? { graphics: readGraphics(v.graphics) } : {}),
    ...(isNumber(v.scale) && v.scale > 0 ? { scale: v.scale } : {}),
    ...(Array.isArray(v.hiddenLayers) ? { hiddenLayers: v.hiddenLayers.filter(isString) } : {}),
  };
  switch (v.kind) {
    case 'plan':
      if (!isNumber(v.cutHeight)) fail(`${path}.cutHeight`, 'must be a number');
      return { ...base, kind: 'plan', level: readLevel(v.level, `${path}.level`), cutHeight: v.cutHeight };
    case 'section': {
      const p = v.plane;
      if (!isObject(p) || !AXES.includes(p.axis as (typeof AXES)[number]) || !isNumber(p.offset)) {
        fail(`${path}.plane`, 'must be { axis, offset, flipped }');
      }
      const plane = { axis: p.axis as (typeof AXES)[number], offset: p.offset, flipped: p.flipped === true };
      return { ...base, kind: 'section', plane: isObject(p.custom) ? { ...plane, custom: p.custom as never } : plane };
    }
    case 'elevation':
      if (!DIRECTIONS.includes(v.direction as ElevationDirection)) fail(`${path}.direction`, `must be one of ${DIRECTIONS.join(', ')}`);
      return { ...base, kind: 'elevation', direction: v.direction as ElevationDirection };
    default:
      return { ...base, kind: '3d', viewpoint: isObject(v.viewpoint) ? (v.viewpoint as never) : null };
  }
}

function readSheet(v: unknown, path: string): ProjectSheet {
  if (!isObject(v) || !isString(v.id) || !isString(v.number) || !isString(v.name)) fail(path, 'must be a sheet { id, number, name }');
  return { id: v.id, number: v.number, name: v.name, createdAt: isNumber(v.createdAt) ? v.createdAt : 0, ...readSheetLayout(v, path) };
}

function readModel(v: unknown, path: string): ProjectModelRef {
  if (!isObject(v) || !isString(v.key) || !isString(v.name)) fail(path, 'must be a model { key, name }');
  return { key: v.key, name: v.name };
}

/** Parse and validate a project file's text. Throws with the first problem found. */
export function parseProjectFile(text: string): ProjectDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not a project file: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!isObject(raw) || raw.format !== PROJECT_FILE_FORMAT) fail('/format', `must be "${PROJECT_FILE_FORMAT}"`);
  if (raw.version !== PROJECT_FILE_VERSION) fail('/version', `${String(raw.version)} is not supported (expected ${PROJECT_FILE_VERSION})`);
  const list = (key: string): unknown[] => {
    const value = raw[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) fail(`/${key}`, 'must be an array');
    return value;
  };
  return {
    name: isString(raw.name) && raw.name.trim() ? raw.name : 'Untitled project',
    models: list('models').map((m, i) => readModel(m, `/models/${i}`)),
    views: list('views').map((v, i) => readView(v, `/views/${i}`)),
    sheets: list('sheets').map((s, i) => readSheet(s, `/sheets/${i}`)),
    drafts: list('drafts').map((d, i) => readDraft(d, `/drafts/${i}`)),
    draftLayers: list('draftLayers').map((l, i) => readDraftLayer(l, `/draftLayers/${i}`)),
    hatchPatterns: isString(raw.hatchPatterns) ? raw.hatchPatterns : '',
    symbolFlips: readFlips(raw.symbolFlips),
    ...(raw.openingLines === 'hinge' || raw.openingLines === 'handle' ? { openingLines: raw.openingLines } : {}),
    ...readStandards(raw),
    joineryTypes: readJoineryList(raw.joineryTypes),
    currentJoinery: readCurrentJoinery(raw.currentJoinery),
    elementTypes: readElementTypeList(raw.elementTypes),
    currentTypes: readCurrentTypes(raw.currentTypes),
    schedules: list('schedules').flatMap((v) => readSchedule(v)),
    structureProfiles: readStructureProfileList(raw.structureProfiles),
    civilDrawings: list('civilDrawings').flatMap((v) => readCivilDrawing(v)),
    typicalSections: list('typicalSections').flatMap((v) => readTypicalSection(v)),
    materials: list('materials').flatMap((v) => readMaterial(v)),
  };
}

const WEIGHTS = new Set(['heavy', 'medium', 'light', 'hairline']);
const HEX = /^#[0-9a-f]{6}$/i;

/** A view's `graphics`: unknown or malformed fields are dropped, never fatal. */
function readGraphics(raw: Record<string, unknown>): ViewGraphics {
  const out: ViewGraphics = {};
  if (raw.presetId === null || isString(raw.presetId)) out.presetId = raw.presetId;
  if (isObject(raw.categories)) {
    const categories: Record<string, CategoryGraphics> = {};
    for (const [id, value] of Object.entries(raw.categories)) {
      if (!isObject(value)) continue;
      const g: CategoryGraphics = {};
      if (value.visible === false) g.visible = false;
      if (isString(value.lineColor) && HEX.test(value.lineColor)) g.lineColor = value.lineColor;
      if (isString(value.fillColor) && HEX.test(value.fillColor)) g.fillColor = value.fillColor;
      if (isString(value.lineWeight) && WEIGHTS.has(value.lineWeight)) g.lineWeight = value.lineWeight as CategoryGraphics['lineWeight'];
      if (isString(value.cutHatch) && value.cutHatch) g.cutHatch = value.cutHatch;
      if (isNumber(value.hatchScale) && value.hatchScale > 0) g.hatchScale = value.hatchScale;
      if (Object.keys(g).length > 0) categories[id] = g;
    }
    out.categories = categories;
  }
  return out;
}

/** `symbolFlips`: GlobalId → 1..3; anything else is dropped. */
function readFlips(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(value)) return out;
  for (const [id, bits] of Object.entries(value)) {
    if (typeof bits === 'number' && Number.isInteger(bits) && bits >= 1 && bits <= 3) out[id] = bits;
  }
  return out;
}

export async function importProjectFile(file: File): Promise<ProjectDocument> {
  return parseProjectFile(await file.text());
}

function readCurrentJoinery(raw: unknown): { door?: string; window?: string } {
  if (!isObject(raw)) return {};
  return {
    ...(isString(raw.door) ? { door: raw.door } : {}),
    ...(isString(raw.window) ? { window: raw.window } : {}),
  };
}

function readMaterial(raw: unknown): ProjectMaterial[] {
  if (!isObject(raw) || !isString(raw.id) || !isString(raw.name) || !raw.name.trim()) return [];
  const out: ProjectMaterial = { id: raw.id, name: raw.name };
  if (raw.hatch === null || isString(raw.hatch)) out.hatch = raw.hatch;
  if (isNumber(raw.hatchScale) && raw.hatchScale > 0) out.hatchScale = raw.hatchScale;
  if (raw.fill === null || (isString(raw.fill) && HEX.test(raw.fill))) out.fill = raw.fill;
  if (isString(raw.hatchPen) && WEIGHTS.has(raw.hatchPen)) out.hatchPen = raw.hatchPen as ProjectMaterial['hatchPen'];
  if (raw.membrane === true) out.membrane = true;
  return [out];
}

function readTypicalSection(raw: unknown): ProjectTypicalSection[] {
  if (!isObject(raw) || !isString(raw.id) || !isObject(raw.assembly)) return [];
  const a = raw.assembly;
  const lane = (v: unknown) => (isObject(v) && isNumber(v.width) && v.width > 0 && isNumber(v.slope) ? { width: v.width, slope: v.slope } : null);
  const lanes = Array.isArray(a.lanes) ? a.lanes.map(lane).filter((l): l is { width: number; slope: number } => l !== null) : [];
  const layers = Array.isArray(a.layers) ? a.layers.flatMap((l) => (isObject(l) && isString(l.name) && isNumber(l.thickness) && l.thickness > 0
    ? [{ name: l.name, thickness: l.thickness, color: isString(l.color) && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#8a7f6a' }] : [])) : [];
  const day = isObject(a.daylight) ? a.daylight : {};
  if (!lanes.length || !layers.length) return [];
  return [{
    id: raw.id, name: isString(raw.name) && raw.name ? raw.name : 'Typical section',
    assembly: {
      lanes, shoulder: lane(a.shoulder), layers,
      daylight: { cutSlope: isNumber(day.cutSlope) && day.cutSlope > 0 ? day.cutSlope : 1, fillSlope: isNumber(day.fillSlope) && day.fillSlope > 0 ? day.fillSlope : 1.5 },
      ...(isNumber(a.nominalDepth) && a.nominalDepth > 0 ? { nominalDepth: a.nominalDepth } : {}),
    },
  }];
}

function readCivilDrawing(raw: unknown): ProjectCivilDrawing[] {
  if (!isObject(raw) || !isString(raw.id) || !isString(raw.corridorGlobalId)) return [];
  const num = (v: unknown, min: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : undefined);
  const out: ProjectCivilDrawing = {
    id: raw.id, name: isString(raw.name) && raw.name ? raw.name : 'Road drawing', kind: raw.kind === 'sections' ? 'sections' : 'profile',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0, corridorGlobalId: raw.corridorGlobalId, scale: num(raw.scale, 1) ?? (raw.kind === 'sections' ? 200 : 1000),
  };
  for (const key of ['vExaggeration', 'stationStep', 'elevationStep', 'every', 'columns', 'halfWidth'] as const) {
    const v = num(raw[key], 0);
    if (v !== undefined) out[key] = v;
  }
  if (Array.isArray(raw.stations)) out.stations = raw.stations.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return [out];
}

function readSchedule(raw: unknown): ProjectSchedule[] {
  if (!isObject(raw) || !isString(raw.id)) return [];
  const kind = raw.kind === 'door' || raw.kind === 'window' ? raw.kind : 'all';
  const out: ProjectSchedule = { id: raw.id, name: isString(raw.name) && raw.name ? raw.name : 'Schedule', kind, createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0 };
  if (typeof raw.scale === 'number' && raw.scale > 0) out.scale = raw.scale;
  return [out];
}
