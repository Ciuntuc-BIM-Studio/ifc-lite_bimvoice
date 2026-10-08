/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drafting and annotating on a sheet itself: the sheet is a drafting target
 * like a view (the same session, commands, command line, snaps and undo),
 * drawing in paper millimetres — y down, as the paper SVG — with annotation
 * sizes read ×10 (`attachDraftingView`'s units scale). The entities live on
 * the sheet's id and are drawn into the paper (`SheetPaper`), so they print
 * and export with it; this hook adds the pointer routing and the overlay
 * (preview, snap, cursor, selection).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '@/project/project-store';
import { draftsOfView } from '@/drafting/draft-store';
import { findSnap } from '@/drafting/snaps';
import {
  attachDraftingView, clickDrawing, constrainPoint, pickEntity, runningCommand, setAnnotationProviders, setDraftSelection,
  setWorkPlaneProvider, useDraftingSession,
} from '@/drafting/session';
import { isGeometry, type Pt, type SnapHit, type SnapMode } from '@/drafting/types';
import type { HatchPattern } from '@/drafting/hatch/pattern';
import { DraftOverlay } from '../drafting/DraftOverlay';

const SNAP_PX = 10;
const PICK_PX = 6;
const MODES: ReadonlySet<SnapMode> = new Set(['endpoint', 'intersection', 'midpoint', 'center', 'quadrant', 'perpendicular', 'nearest']);
/** Annotation sizes on paper: millimetres, as on a 1:100 view. */
const SHEET_UNITS = 10;
const NO_SHAPES: never[] = [];

interface Pan { x: number; y: number; k: number }

export function useSheetDrafting(sheetId: string, pan: Pan, extraPatterns: readonly HatchPattern[]) {
  const drafts = useProjectStore((s) => s.drafts);
  const layers = useProjectStore((s) => s.draftLayers);
  const selection = useDraftingSession((s) => s.selection);
  const snapOn = useDraftingSession((s) => s.snap);
  useDraftingSession((s) => s.revision);
  const entities = useMemo(() => draftsOfView(sheetId, drafts), [drafts, sheetId]);
  const shapes = useMemo(() => entities.flatMap((e) => (isGeometry(e.shape) ? [e.shape] : [])), [entities]);
  const [cursor, setCursor] = useState<{ p: Pt; snap: SnapHit | null } | null>(null);

  useEffect(() => {
    attachDraftingView(sheetId, 'down', () => [], SHEET_UNITS);
    setWorkPlaneProvider(() => null, () => null);
    setAnnotationProviders(
      () => entities.flatMap((e) => (e.shape.type === 'polyline' && e.shape.closed ? [e.shape.pts] : [])),
      () => 0,
    );
  }, [sheetId, entities]);

  const resolve = useCallback((raw: Pt): { p: Pt; snap: SnapHit | null } => {
    const command = runningCommand();
    if (command?.input() !== 'point') return { p: raw, snap: null };
    const hit = snapOn ? findSnap(raw, shapes, null, { tolerance: SNAP_PX / pan.k, modes: MODES, from: command.basePoint() }) : null;
    return hit ? { p: hit.point, snap: hit } : { p: constrainPoint(raw), snap: null };
  }, [snapOn, shapes, pan.k]);

  /** A press on the paper: true when drafting took it (a running command, or a sheet annotation). */
  const down = (p: Pt, additive: boolean): boolean => {
    const tolerance = PICK_PX / pan.k;
    if (runningCommand()) {
      clickDrawing(resolve(p).p, tolerance, additive);
      return true;
    }
    if (pickEntity(p, tolerance)) {
      clickDrawing(p, tolerance, additive);
      return true;
    }
    if (selection.size > 0 && !additive) setDraftSelection(new Set());
    return false;
  };

  const move = (p: Pt): boolean => {
    const running = runningCommand() !== null;
    setCursor(running ? resolve(p) : null);
    return running;
  };

  const command = runningCommand();
  const preview = command && cursor && command.preview ? command.preview(cursor.p) : NO_SHAPES;
  const overlay = (
    <DraftOverlay
      entities={entities.filter((e) => selection.has(e.id))}
      layers={layers}
      selection={selection}
      hoverId={null}
      preview={preview}
      snap={cursor?.snap ?? null}
      cursor={cursor?.p ?? null}
      window={null}
      highlight={NO_SHAPES}
      extraPatterns={extraPatterns}
      transform={{ scale: pan.k, x: pan.x, y: pan.y }}
      axis="down"
    />
  );
  return { entities, down, move, overlay, drafting: command !== null };
}
