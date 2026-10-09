/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The central document area: a tab strip (3D model + every opened plan,
 * section and elevation, side by side) over the workspace.
 *
 * The 3D workspace (`children`) stays mounted whatever tab is in front —
 * remounting the viewport re-creates its GPU device — and a drawing tab
 * covers it with its drafting view (the drawing plus drafting tools). `data-floating-snap-bounds` stays on the
 * workspace box: edge-docked floating panels (#1201) snap to THIS region,
 * not the whole window, so a dock never hides under the toolbar or over the
 * hierarchy / sidebar (#1245).
 */

import { useEffect, type ReactNode } from 'react';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { MODEL_TAB_ID, pruneDocumentTabs, useDocumentTabs } from '@/project/document-tabs';
import { closeProjectTab } from '@/project/open-view';
import { EMPTY_VIEW_DRAWING, useViewDrawings } from '@/project/view-drawings';
import { DocumentTabBar } from './DocumentTabBar';
import { ViewDrawingHost } from './ViewDrawingHost';
import { DraftingView } from '../drafting/DraftingView';
import { SheetView } from '../sheets/SheetView';
import { ScheduleView } from '../joinery/ScheduleView';
import { CivilDrawingView } from '../civil/CivilDrawingView';


/**
 * Show the front tab's own drawing in the viewer's one `drawing2D`, which
 * the Drawing panel's canvas, toolbar and exports read.
 */
function useMirrorFrontDrawing(activeId: string): void {
  const entry = useViewDrawings((s) => (activeId === MODEL_TAB_ID ? null : s.byView[activeId] ?? EMPTY_VIEW_DRAWING));
  useEffect(() => {
    if (!entry) return;
    const store = useViewerStore.getState();
    store.setDrawing2D(entry.drawing);
    store.setDrawing2DProgress(entry.progress, entry.phase);
    store.setDrawing2DError(entry.error);
    store.setDrawing2DStatus(entry.status);
  }, [entry]);
}

export function DocumentWorkspace({ children }: { children: ReactNode }) {
  const activeId = useDocumentTabs((s) => s.activeId);
  const openIds = useDocumentTabs((s) => s.openIds);
  const views = useProjectStore((s) => s.views);
  const sheets = useProjectStore((s) => s.sheets);
  const schedules = useProjectStore((s) => s.schedules);
  const civilDrawings = useProjectStore((s) => s.civilDrawings);
  useMirrorFrontDrawing(activeId);
  // Views that need their own drawing: open as a tab, or placed on a sheet that is open as a tab.
  const drawn = new Set(openIds);
  for (const sheet of sheets) {
    if (openIds.includes(sheet.id)) for (const vp of sheet.viewports ?? []) drawn.add(vp.viewId);
  }

  // A deleted view (or another project loaded) takes its tab with it.
  useEffect(() => {
    const ids = new Set([...views.map((v) => v.id), ...sheets.map((s) => s.id), ...(schedules ?? []).map((s) => s.id), ...(civilDrawings ?? []).map((d) => d.id)]);
    const { activeId: front } = useDocumentTabs.getState();
    if (front !== MODEL_TAB_ID && !ids.has(front)) closeProjectTab(front);
    pruneDocumentTabs(ids);
  }, [views, sheets, schedules, civilDrawings]);

  const frontView = activeId === MODEL_TAB_ID ? undefined : views.find((v) => v.id === activeId);
  const frontSheet = activeId === MODEL_TAB_ID ? undefined : sheets.find((s) => s.id === activeId);
  const frontSchedule = activeId === MODEL_TAB_ID ? undefined : schedules?.find((s) => s.id === activeId);
  const frontCivil = activeId === MODEL_TAB_ID ? undefined : civilDrawings?.find((d) => d.id === activeId);
  return (
    <div className="h-full w-full flex flex-col">
      <DocumentTabBar />
      {[...drawn].map((id) => {
        const view = views.find((v) => v.id === id);
        return view && view.kind !== '3d' ? <ViewDrawingHost key={id} view={view} /> : null;
      })}
      <div data-floating-snap-bounds className="relative flex-1 min-h-0 w-full overflow-hidden flex">
        {children}
        {frontView && frontView.kind !== '3d' ? (
          <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-black">
            <DraftingView key={frontView.id} view={frontView} />
          </div>
        ) : null}
        {frontSchedule ? (
          <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-black">
            <ScheduleView key={frontSchedule.id} schedule={frontSchedule} />
          </div>
        ) : null}
        {frontCivil ? (
          <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-black">
            <CivilDrawingView key={frontCivil.id} drawing={frontCivil} />
          </div>
        ) : null}
        {frontSheet ? (
          <div className="absolute inset-0 z-30 flex flex-col bg-zinc-200 dark:bg-zinc-900">
            <SheetView key={frontSheet.id} sheet={frontSheet} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
