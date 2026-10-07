/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Work plane from a face: bring the 3D view forward, arm the Section tool's
 * face pick, and when a face is picked save that plane as a section view
 * and open it — a work plane in any orientation to draft on. The face pick
 * is ifc-lite's own (`sectionPickMode`); this only listens for its result.
 */

import { useViewerStore } from '@/store';
import { activateDocumentTab, openProjectView, saveLiveSectionAsView } from './open-view';
import { MODEL_TAB_ID } from './document-tabs';

let waiting: (() => void) | null = null;

export function startWorkPlaneFromFace(name = 'Work plane'): void {
  waiting?.();
  activateDocumentTab(MODEL_TAB_ID);
  const state = useViewerStore.getState();
  const before = state.sectionPlane.custom;
  if (state.activeTool !== 'section') state.setActiveTool('section', 'programmatic');
  useViewerStore.getState().setSectionPickMode(true);
  const unsubscribe = useViewerStore.subscribe((s, prev) => {
    // The pick commits a new custom plane; leaving the tool cancels.
    if (s.sectionPlane.custom && s.sectionPlane.custom !== before && s.sectionPlane.custom !== prev.sectionPlane.custom) {
      stop();
      const id = saveLiveSectionAsView(name);
      if (id) openProjectView(id);
    } else if (s.activeTool !== 'section') {
      stop();
    }
  });
  const stop = () => {
    unsubscribe();
    waiting = null;
  };
  waiting = stop;
}
