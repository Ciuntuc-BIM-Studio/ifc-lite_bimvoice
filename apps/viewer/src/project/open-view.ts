/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Opening project views in the central document tabs, and capturing the
 * live state as a new view.
 *
 * Every open drawing tab generates its own drawing (`ViewDrawingHost`,
 * phase 3b); the tab in front also points the viewer's section plane at its
 * view so the Drawing panel, exports and BCF capture describe it. The 3D
 * tab keeps its own section state: snapshotted when a drawing tab comes
 * forward, restored when 3D is back in front.
 */

import { useViewerStore } from '@/store';
import type { SectionPlane } from '@/store/types';
import { mergedSectionBounds } from '@/lib/section/section-distance';
import { addProjectView, setActiveProjectItem, useProjectStore } from './project-store';
import { projectPlaneFromSection, sectionPlaneForView } from './view-plane';
import { closeDocumentTab, isDrawingTabActive, MODEL_TAB_ID, showDocumentTab, useDocumentTabs } from './document-tabs';
import type { ProjectView } from './types';

export type OpenViewResult = 'opened' | 'unresolved' | 'missing';

function liveBounds() {
  const state = useViewerStore.getState();
  return mergedSectionBounds(state.models, state.geometryResult);
}

/** The 3D tab's own section state, held while a drawing tab owns the plane. */
let model3DSection: { plane: SectionPlane; tool: string } | null = null;

function leaveModelTab(): void {
  if (isDrawingTabActive()) return;
  const state = useViewerStore.getState();
  model3DSection = { plane: state.sectionPlane, tool: state.activeTool };
  // Each drawing tab generates its own drawing (`ViewDrawingHost`); the
  // shared live-section generator stays idle while a drawing is in front.
  if (state.activeTool === 'section') state.setActiveTool('select', 'programmatic');
  if (state.drawing2DPanelVisible) state.setDrawing2DPanelVisible(false);
}

function restoreModelTab(): void {
  const snapshot = model3DSection;
  model3DSection = null;
  const state = useViewerStore.getState();
  const plane = snapshot?.plane ?? { ...state.sectionPlane, enabled: false, parked: false };
  useViewerStore.setState({ sectionPlane: plane, sceneState: { ...state.sceneState, section: { visible: true } } });
  const tool = snapshot?.tool ?? 'select';
  if (state.activeTool !== tool) state.setActiveTool(tool as Parameters<typeof state.setActiveTool>[0], 'programmatic');
}

/**
 * Point the viewer's section plane at a drawing view, so the Drawing
 * panel's header, exports and BCF capture describe the drawing in front.
 * `false` when the view cannot resolve.
 */
function applyDrawingView(view: Exclude<ProjectView, { kind: '3d' }>): boolean {
  const project = useProjectStore.getState();
  const plane = sectionPlaneForView(view, liveBounds(), project.levels);
  if (!plane) return false;
  const state = useViewerStore.getState();
  useViewerStore.setState({
    sectionPlane: { ...state.sectionPlane, ...plane, custom: plane.custom, box: undefined, enabled: true, parked: false },
  });
  return true;
}

/** Bring a document tab to the front (the 3D tab, or an open drawing view). */
export function activateDocumentTab(id: string): OpenViewResult {
  if (id === MODEL_TAB_ID) {
    if (isDrawingTabActive()) restoreModelTab();
    showDocumentTab(MODEL_TAB_ID);
    return 'opened';
  }
  const project = useProjectStore.getState();
  if (project.sheets.some((s) => s.id === id) || project.schedules?.some((s) => s.id === id)) {
    // A sheet shows its viewports' own drawings; the 3D section state is set aside like for a view.
    leaveModelTab();
    setActiveProjectItem(id);
    showDocumentTab(id);
    return 'opened';
  }
  const view = project.views.find((v) => v.id === id);
  if (!view) return 'missing';
  if (view.kind === '3d') return openProjectView(id);
  leaveModelTab();
  // Without geometry there is no section to point at, but the view is still a work plane to draft on.
  if (!applyDrawingView(view) && liveBounds() !== null) return 'unresolved';
  setActiveProjectItem(id);
  showDocumentTab(id);
  return 'opened';
}

/** Close a drawing tab; when it was in front, the tab that takes its place is shown. */
export function closeProjectTab(id: string): void {
  const wasFront = useDocumentTabs.getState().activeId === id;
  const next = closeDocumentTab(id);
  if (!wasFront) return;
  if (next === MODEL_TAB_ID) {
    restoreModelTab();
    return;
  }
  const view = useProjectStore.getState().views.find((v) => v.id === next);
  if (view && view.kind !== '3d') applyDrawingView(view);
  else setActiveProjectItem(next);
}

/** Open a project view: drawing views in their own tab, 3D views on the 3D tab. */
export function openProjectView(id: string): OpenViewResult {
  const view = useProjectStore.getState().views.find((v) => v.id === id);
  if (!view) return 'missing';
  if (view.kind !== '3d') return activateDocumentTab(id);
  setActiveProjectItem(id);
  activateDocumentTab(MODEL_TAB_ID);
  const { cameraCallbacks } = useViewerStore.getState();
  if (view.viewpoint) cameraCallbacks.applyViewpoint?.(view.viewpoint, true);
  else cameraCallbacks.home?.();
  return 'opened';
}

/** Save the live section cut as a new section view. Returns its id, or `null` if there is no plane cut. */
export function saveLiveSectionAsView(name = 'Section'): string | null {
  const { sectionPlane } = useViewerStore.getState();
  if (!sectionPlane.enabled || sectionPlane.box) return null;
  const plane = projectPlaneFromSection(sectionPlane, liveBounds());
  if (!plane) return null;
  return addProjectView({ kind: 'section', name, plane });
}

/** Save the live camera as a new 3D view. Returns its id, or `null` with no camera yet. */
export function saveLiveCameraAsView(name = '3D View'): string | null {
  const viewpoint = useViewerStore.getState().cameraCallbacks.getViewpoint?.() ?? null;
  if (!viewpoint) return null;
  return addProjectView({ kind: '3d', name, viewpoint });
}
