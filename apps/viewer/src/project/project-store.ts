/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project document store: views and sheets over the loaded models.
 *
 * Its OWN zustand store rather than a `ViewerState` slice, for the reasons
 * `savedSectionCutsStore.ts` gives: the viewer store is at its module-size
 * ratchet, and a project is a user-authored document that a model swap
 * must not tear down. The only coupling to the viewer store is one-way and
 * lives in `open-view.ts` / `project-sync.ts`.
 */

import { create } from 'zustand';
import { defaultViews, freshProjectId, levelsFromStoreys, syncDefaultViews, uniqueViewName, type StoreyInput } from './view-defaults';
import type { NewProjectView, ProjectViewPatch, ProjectDocument, ProjectLevel, ProjectModelRef, ProjectSheet, ProjectView } from './types';

export interface ProjectState extends ProjectDocument {
  /** Levels of the currently loaded models (derived, never persisted). */
  levels: ProjectLevel[];
  /** The view or sheet last opened from the navigator. */
  activeItemId: string | null;
  /** Edited since the last save to / load from a project file. */
  dirty: boolean;
}

export const EMPTY_PROJECT: ProjectDocument = { name: 'Untitled project', models: [], views: [], sheets: [] };

export const useProjectStore = create<ProjectState>()(() => ({
  ...EMPTY_PROJECT,
  levels: [],
  activeItemId: null,
  dirty: false,
}));

/** The persisted part of the store. */
export function projectDocument(state: ProjectState = useProjectStore.getState()): ProjectDocument {
  return { name: state.name, models: state.models, views: state.views, sheets: state.sheets };
}

/** Replace the document (file import, autosave restore). */
export function loadProjectDocument(doc: ProjectDocument, options: { dirty?: boolean } = {}): void {
  const { levels } = useProjectStore.getState();
  useProjectStore.setState({
    ...doc,
    views: [...syncDefaultViews(doc.views, levels)],
    activeItemId: null,
    dirty: options.dirty ?? false,
  });
}

/**
 * Point the project at the loaded models. A project with no views yet gets
 * the default set; an existing one only gains plans for new levels.
 */
export function syncProjectWithModels(models: ProjectModelRef[], storeys: readonly StoreyInput[]): void {
  const state = useProjectStore.getState();
  const levels = levelsFromStoreys(storeys);
  const views = state.views.length === 0 ? defaultViews(levels) : syncDefaultViews(state.views, levels);
  const modelsChanged = !knowsAll(state.models, models);
  if (!modelsChanged && views === state.views && sameLevels(state.levels, levels)) return;
  useProjectStore.setState({
    levels,
    models: modelsChanged ? mergeModels(state.models, models) : state.models,
    views: views === state.views ? state.views : [...views],
    dirty: state.dirty || views !== state.views || modelsChanged,
  });
}

export function resetProject(): void {
  useProjectStore.setState({ ...EMPTY_PROJECT, activeItemId: null, dirty: false });
}

export function setProjectName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) useProjectStore.setState({ name: trimmed, dirty: true });
}

export function setActiveProjectItem(id: string | null): void {
  useProjectStore.setState({ activeItemId: id });
}

export function addProjectView(view: NewProjectView): string {
  const state = useProjectStore.getState();
  const id = view.id ?? freshProjectId('view');
  const created = { ...view, id, name: uniqueViewName(view.name, state.views), createdAt: Date.now() } as ProjectView;
  useProjectStore.setState({ views: [...state.views, created], dirty: true });
  return id;
}

export function renameProjectItem(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const state = useProjectStore.getState();
  if (state.views.some((v) => v.id === id)) {
    const others = state.views.filter((v) => v.id !== id);
    const unique = uniqueViewName(trimmed, others);
    useProjectStore.setState({ views: state.views.map((v) => (v.id === id ? { ...v, name: unique } : v)), dirty: true });
    return;
  }
  useProjectStore.setState({ sheets: state.sheets.map((s) => (s.id === id ? { ...s, name: trimmed } : s)), dirty: true });
}

/** Change a view's settings (cut height, view depth, section plane…). Its id and kind never change. */
export function updateProjectView(id: string, patch: ProjectViewPatch): void {
  const state = useProjectStore.getState();
  if (!state.views.some((v) => v.id === id)) return;
  useProjectStore.setState({
    views: state.views.map((v) => (v.id === id ? ({ ...v, ...patch, id: v.id, kind: v.kind } as ProjectView) : v)),
    dirty: true,
  });
}

export function duplicateProjectView(id: string): string | null {
  const state = useProjectStore.getState();
  const source = state.views.find((v) => v.id === id);
  if (!source) return null;
  const copy = { ...structuredClone(source), id: freshProjectId('view'), name: uniqueViewName(`${source.name} Copy`, state.views), auto: false, createdAt: Date.now() };
  const at = state.views.indexOf(source) + 1;
  useProjectStore.setState({ views: [...state.views.slice(0, at), copy, ...state.views.slice(at)], dirty: true });
  return copy.id;
}

export function removeProjectItem(id: string): void {
  const state = useProjectStore.getState();
  useProjectStore.setState({
    views: state.views.filter((v) => v.id !== id),
    sheets: state.sheets.filter((s) => s.id !== id),
    activeItemId: state.activeItemId === id ? null : state.activeItemId,
    dirty: true,
  });
}

/** The next free sheet number in the `A-101`, `A-102`… series. */
export function nextSheetNumber(sheets: readonly ProjectSheet[]): string {
  const taken = new Set(sheets.map((s) => s.number));
  for (let n = 101; ; n++) {
    const number = `A-${n}`;
    if (!taken.has(number)) return number;
  }
}

export function addProjectSheet(name = 'Unnamed'): string {
  const state = useProjectStore.getState();
  const sheet: ProjectSheet = { id: freshProjectId('sheet'), number: nextSheetNumber(state.sheets), name, createdAt: Date.now() };
  useProjectStore.setState({ sheets: [...state.sheets, sheet], dirty: true });
  return sheet.id;
}

export function setSheetNumber(id: string, number: string): void {
  const trimmed = number.trim();
  if (!trimmed) return;
  useProjectStore.setState((s) => ({ sheets: s.sheets.map((sh) => (sh.id === id ? { ...sh, number: trimmed } : sh)), dirty: true }));
}

/** Whether every loaded model is already in the project's model list. */
function knowsAll(known: readonly ProjectModelRef[], loaded: readonly ProjectModelRef[]): boolean {
  return loaded.every((m) => known.some((k) => k.key === m.key));
}

/** Keep models the project already knew (a file may name models not loaded yet), add new ones. */
function mergeModels(known: readonly ProjectModelRef[], loaded: readonly ProjectModelRef[]): ProjectModelRef[] {
  const merged = [...known];
  for (const model of loaded) if (!merged.some((m) => m.key === model.key)) merged.push(model);
  return merged;
}

function sameLevels(a: readonly ProjectLevel[], b: readonly ProjectLevel[]): boolean {
  return a.length === b.length && a.every((l, i) => l.name === b[i].name && l.elevation === b[i].elevation);
}
