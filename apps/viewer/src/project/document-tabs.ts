/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The central document tabs: the 3D model tab (always there) plus one tab
 * per opened plan / section / elevation, side by side like Revit's view
 * tabs. A tab is only where a project view is open; closing it never
 * deletes the view.
 *
 * Phase 3a: there is still ONE live drawing. Activating a drawing tab points
 * the live section plane at its view (`open-view.ts`) and the central pane
 * shows the drawing; activating the 3D tab restores the section state the
 * 3D view had before a drawing tab took the plane over.
 */

import { create } from 'zustand';

/** The permanent 3D model tab. */
export const MODEL_TAB_ID = 'model-3d';

interface DocumentTabsState {
  /** Opened drawing views (project view ids), in tab order. */
  openIds: string[];
  /** `MODEL_TAB_ID` or one of `openIds`. */
  activeId: string;
}

export const useDocumentTabs = create<DocumentTabsState>()(() => ({
  openIds: [],
  activeId: MODEL_TAB_ID,
}));

/** Whether a drawing tab (not the 3D tab) is in front. */
export function isDrawingTabActive(state: DocumentTabsState = useDocumentTabs.getState()): boolean {
  return state.activeId !== MODEL_TAB_ID;
}

/** Add `id` as a tab (if not open yet) and put it in front. */
export function showDocumentTab(id: string): void {
  useDocumentTabs.setState((s) => ({
    openIds: id === MODEL_TAB_ID || s.openIds.includes(id) ? s.openIds : [...s.openIds, id],
    activeId: id,
  }));
}

/**
 * Remove a tab. Closing the front tab brings its right neighbour forward
 * (else the left one, else the 3D tab). Returns the new front tab id.
 */
export function closeDocumentTab(id: string): string {
  const { openIds, activeId } = useDocumentTabs.getState();
  const at = openIds.indexOf(id);
  if (at < 0) return activeId;
  const remaining = openIds.filter((t) => t !== id);
  const nextActive = activeId !== id ? activeId : (remaining[at] ?? remaining[at - 1] ?? MODEL_TAB_ID);
  useDocumentTabs.setState({ openIds: remaining, activeId: nextActive });
  return nextActive;
}

/** Drop tabs whose view no longer exists (deleted, or another project loaded). */
export function pruneDocumentTabs(viewIds: ReadonlySet<string>): void {
  const { openIds, activeId } = useDocumentTabs.getState();
  const kept = openIds.filter((id) => viewIds.has(id));
  if (kept.length === openIds.length) return;
  useDocumentTabs.setState({ openIds: kept, activeId: activeId === MODEL_TAB_ID || kept.includes(activeId) ? activeId : MODEL_TAB_ID });
}
