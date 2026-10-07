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
import type { ElevationDirection, ProjectDocument, ProjectLevel, ProjectModelRef, ProjectSheet, ProjectView, ProjectViewKind } from './types';

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
  return { id: v.id, number: v.number, name: v.name, createdAt: isNumber(v.createdAt) ? v.createdAt : 0 };
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
  };
}

export async function importProjectFile(file: File): Promise<ProjectDocument> {
  return parseProjectFile(await file.text());
}
