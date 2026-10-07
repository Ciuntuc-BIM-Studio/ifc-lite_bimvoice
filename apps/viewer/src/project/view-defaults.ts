/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The views a project starts with: one floor plan per building level, the
 * four elevations and a default 3D view. `syncDefaultViews` keeps the plan
 * list in step with the loaded models without ever deleting a view: a plan
 * whose level is gone stays (the navigator shows it as unresolved), so a
 * project file opened before its models load loses nothing.
 */

import type { ElevationDirection, ProjectLevel, ProjectView, PlanProjectView } from './types';

/** Standard architectural plan-cut height above the floor, metres. */
export const DEFAULT_PLAN_CUT_HEIGHT_M = 1.2;

/** Levels closer than this are the same level (federated models repeat them). */
export const LEVEL_MATCH_TOLERANCE_M = 0.25;

export const ELEVATION_DIRECTIONS: readonly ElevationDirection[] = ['north', 'east', 'south', 'west'];

const ELEVATION_NAMES: Record<ElevationDirection, string> = {
  north: 'North Elevation',
  east: 'East Elevation',
  south: 'South Elevation',
  west: 'West Elevation',
};

export interface StoreyInput {
  name: string;
  elevation: number;
  globalId?: string;
}

export function freshProjectId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/**
 * Merge storeys from every model into levels: storeys within
 * {@link LEVEL_MATCH_TOLERANCE_M} of each other are one level (the shortest
 * name wins), sorted top-down like a project browser lists them.
 */
export function levelsFromStoreys(storeys: readonly StoreyInput[]): ProjectLevel[] {
  const levels: ProjectLevel[] = [];
  const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation);
  for (const storey of sorted) {
    const match = levels.find((l) => sameElevation(l.elevation, storey.elevation));
    if (match) {
      if (storey.globalId && !match.storeyGlobalIds.includes(storey.globalId)) match.storeyGlobalIds.push(storey.globalId);
      if (storey.name.length < match.name.length) match.name = storey.name;
      continue;
    }
    levels.push({ name: storey.name, elevation: storey.elevation, storeyGlobalIds: storey.globalId ? [storey.globalId] : [] });
  }
  return levels.sort((a, b) => b.elevation - a.elevation);
}

export function sameElevation(a: number, b: number): boolean {
  return Math.abs(a - b) < LEVEL_MATCH_TOLERANCE_M;
}

/** The level a plan view resolves to among the loaded ones, if any. */
export function resolvePlanLevel(view: PlanProjectView, levels: readonly ProjectLevel[]): ProjectLevel | undefined {
  const byId = levels.find((l) => l.storeyGlobalIds.some((g) => view.level.storeyGlobalIds.includes(g)));
  return byId ?? levels.find((l) => sameElevation(l.elevation, view.level.elevation));
}

/** `base`, or `base (2)`, `base (3)`… — the first name no other view uses (case-insensitive). */
export function uniqueViewName(base: string, views: readonly Pick<ProjectView, 'name'>[]): string {
  const taken = new Set(views.map((v) => v.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function planViewFor(level: ProjectLevel, views: readonly ProjectView[], now = Date.now()): PlanProjectView {
  return {
    id: freshProjectId('view'),
    kind: 'plan',
    name: uniqueViewName(level.name, views),
    level: { ...level, storeyGlobalIds: [...level.storeyGlobalIds] },
    cutHeight: DEFAULT_PLAN_CUT_HEIGHT_M,
    auto: true,
    createdAt: now,
  };
}

/** The views a brand-new project gets for `levels`. */
export function defaultViews(levels: readonly ProjectLevel[], now = Date.now()): ProjectView[] {
  const views: ProjectView[] = [];
  for (const level of levels) views.push(planViewFor(level, views, now));
  for (const direction of ELEVATION_DIRECTIONS) {
    views.push({ id: freshProjectId('view'), kind: 'elevation', name: ELEVATION_NAMES[direction], direction, auto: true, createdAt: now });
  }
  views.push({ id: freshProjectId('view'), kind: '3d', name: '{3D}', viewpoint: null, auto: true, createdAt: now });
  return views;
}

/**
 * Add a plan for every loaded level no plan resolves to yet. Returns the
 * same array when nothing changed, so callers can skip a store write.
 */
export function syncDefaultViews(views: readonly ProjectView[], levels: readonly ProjectLevel[], now = Date.now()): readonly ProjectView[] {
  const plans = views.filter((v): v is PlanProjectView => v.kind === 'plan');
  const missing = levels.filter((level) => !plans.some((p) => resolvePlanLevel(p, [level])));
  if (missing.length === 0) return views;
  const next = [...views];
  for (const level of missing) next.push(planViewFor(level, next, now));
  return next;
}
