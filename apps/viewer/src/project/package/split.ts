/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project document ↔ package parts. Splitting is by field: views,
 * sheets, standards and catalogues each get a part, the drafts one part per
 * view (or sheet) they are drawn on, and every other field — including ones
 * a newer app adds — stays in `project/document.json`, so nothing is ever
 * dropped. Merging gives back the document's JSON object, which the project
 * file reader validates as it does a `.ifclite-project.json`.
 */

import type { ProjectDocument } from '../types';
import { segment } from './format';

type Json = Record<string, unknown>;

const GROUPS: Record<string, readonly string[]> = {
  'project/views.json': ['views'],
  'project/sheets.json': ['sheets'],
  'project/standards.json': ['draftLayers', 'layerGroups', 'textStyles', 'dimStyles', 'hatchPatterns'],
  'project/catalogs.json': ['joineryTypes', 'currentJoinery', 'elementTypes', 'currentTypes', 'schedules', 'structureProfiles', 'civilDrawings', 'typicalSections'],
};
const DOCUMENT = 'project/document.json';
const DRAFTS = 'project/drafts/';

/** The document as part path → JSON value. */
export function splitDocument(doc: ProjectDocument): Map<string, unknown> {
  const rest: Json = { ...(doc as unknown as Json) };
  const parts = new Map<string, unknown>();
  for (const [path, keys] of Object.entries(GROUPS)) {
    const group: Json = {};
    for (const key of keys) {
      if (key in rest) group[key] = rest[key];
      delete rest[key];
    }
    if (Object.keys(group).length) parts.set(path, group);
  }
  const drafts = Array.isArray(rest.drafts) ? (rest.drafts as { viewId?: unknown }[]) : [];
  delete rest.drafts;
  const byView = new Map<string, unknown[]>();
  for (const d of drafts) {
    const view = typeof d.viewId === 'string' ? d.viewId : '';
    byView.set(view, [...(byView.get(view) ?? []), d]);
  }
  // Two view ids could share a path segment: keep them apart by numbering.
  const used = new Set<string>();
  for (const [view, list] of byView) {
    let name = segment(view || 'unplaced');
    for (let i = 2; used.has(name); i++) name = `${segment(view || 'unplaced')}-${i}`;
    used.add(name);
    parts.set(`${DRAFTS}${name}.json`, { drafts: list });
  }
  parts.set(DOCUMENT, rest);
  return parts;
}

/** The parts back into one document object (unvalidated). */
export function mergeParts(parts: ReadonlyMap<string, unknown>): Json {
  const doc = parts.get(DOCUMENT);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`Not a project package: ${DOCUMENT} is missing`);
  const out: Json = { ...(doc as Json) };
  const drafts: unknown[] = [];
  // Draft parts in path order: the document's draft order is by view, then as drawn.
  for (const [path, value] of [...parts].sort(([a], [b]) => a.localeCompare(b))) {
    if (path === DOCUMENT) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Not a project package: ${path} is not an object`);
    if (path.startsWith(DRAFTS)) {
      const list = (value as Json).drafts;
      if (!Array.isArray(list)) throw new Error(`Not a project package: ${path} has no drafts`);
      drafts.push(...list);
    } else {
      Object.assign(out, value);
    }
  }
  out.drafts = drafts;
  return out;
}

/** Whether a package path holds a document part. */
export const isDocumentPart = (path: string): boolean => path.startsWith('project/') && path.endsWith('.json');
