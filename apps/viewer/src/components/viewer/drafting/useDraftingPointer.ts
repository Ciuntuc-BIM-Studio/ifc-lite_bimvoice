/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pointer handling for a drafting view: snapping, clicks into the running
 * command, window / crossing selection, middle-button pan and wheel zoom
 * about the cursor. (Space is the CAD confirm key, so it does not pan.)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { screenToDrawing, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { clickDrawing, constrainPoint, pickEntity, runningCommand, useDraftingSession, windowSelect } from '@/drafting/session';
import { findSnap } from '@/drafting/snaps';
import { capturePointer } from '@/lib/pointer-capture';
import { referencesIn, type ReferenceSet } from '@/drafting/references';
import type { DraftShape, Pt, SnapHit, SnapMode } from '@/drafting/types';

const SNAP_PX = 10;
const PICK_PX = 6;
const DRAG_PX = 4;
const SNAP_ORDER: readonly SnapMode[] = ['endpoint', 'intersection', 'midpoint', 'center', 'quadrant', 'perpendicular', 'nearest'];
const ALL_MODES: ReadonlySet<SnapMode> = new Set(SNAP_ORDER);

function better(a: SnapHit | null, b: SnapHit | null, cursor: Pt): SnapHit | null {
  if (!a) return b;
  if (!b) return a;
  const ra = SNAP_ORDER.indexOf(a.mode);
  const rb = SNAP_ORDER.indexOf(b.mode);
  if (ra !== rb) return ra < rb ? a : b;
  const da = Math.hypot(a.point.x - cursor.x, a.point.y - cursor.y);
  const db = Math.hypot(b.point.x - cursor.x, b.point.y - cursor.y);
  return da <= db ? a : b;
}

interface Params {
  containerRef: React.RefObject<HTMLDivElement | null>;
  transform: ViewTransform;
  setTransform: React.Dispatch<React.SetStateAction<ViewTransform>>;
  axis: SectionAxisName;
  entityShapes: readonly DraftShape[];
  references: ReferenceSet | null;
}

export interface DraftingPointerState {
  cursor: Pt | null;
  snap: SnapHit | null;
  hoverId: string | null;
  window: { a: Pt; b: Pt } | null;
}

export function useDraftingPointer({ containerRef, transform, setTransform, axis, entityShapes, references }: Params) {
  const snapOn = useDraftingSession((s) => s.snap);
  const [state, setState] = useState<DraftingPointerState>({ cursor: null, snap: null, hoverId: null, window: null });
  const drag = useRef<{ kind: 'pan' | 'window'; startScreen: Pt; startDrawing: Pt; startTransform: ViewTransform } | null>(null);

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const resolve = useCallback((raw: Pt): { point: Pt; snap: SnapHit | null } => {
    const command = runningCommand();
    const wantsPoint = command?.input() === 'point';
    if (!wantsPoint || !snapOn) return { point: wantsPoint ? constrainPoint(raw) : raw, snap: null };
    const tolerance = SNAP_PX / transform.scale;
    const from = command?.basePoint() ?? null;
    let hit = findSnap(raw, entityShapes, null, { tolerance, modes: ALL_MODES, from });
    if (references) {
      const min = { x: raw.x - tolerance, y: raw.y - tolerance };
      const max = { x: raw.x + tolerance, y: raw.y + tolerance };
      hit = better(hit, findSnap(raw, referencesIn(references, min, max), null, { tolerance, modes: ALL_MODES, from }), raw);
    }
    return hit ? { point: hit.point, snap: hit } : { point: constrainPoint(raw), snap: null };
  }, [snapOn, transform.scale, entityShapes, references]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = local(e);
    const d = drag.current;
    if (d?.kind === 'pan') {
      setTransform({ ...d.startTransform, x: d.startTransform.x + s.x - d.startScreen.x, y: d.startTransform.y + s.y - d.startScreen.y });
      return;
    }
    const raw = screenToDrawing(s, transform, axis);
    const { point, snap } = resolve(raw);
    const command = runningCommand();
    const hoverId = !command || command.input() === 'pick' ? pickEntity(raw, PICK_PX / transform.scale)?.id ?? null : null;
    const window = d?.kind === 'window' && Math.hypot(s.x - d.startScreen.x, s.y - d.startScreen.y) > DRAG_PX ? { a: d.startDrawing, b: raw } : null;
    setState({ cursor: point, snap, hoverId, window });
  }, [transform, axis, resolve, setTransform]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const s = local(e);
    capturePointer(e.currentTarget as HTMLElement, e.pointerId);
    if (e.button === 1) {
      e.preventDefault();
      drag.current = { kind: 'pan', startScreen: s, startDrawing: screenToDrawing(s, transform, axis), startTransform: transform };
      return;
    }
    if (e.button !== 0) return;
    const raw = screenToDrawing(s, transform, axis);
    const command = runningCommand();
    if (command && command.input() === 'point') {
      clickDrawing(resolve(raw).point, PICK_PX / transform.scale, e.shiftKey);
      return;
    }
    if (command) {
      clickDrawing(raw, PICK_PX / transform.scale, e.shiftKey);
      return;
    }
    drag.current = { kind: 'window', startScreen: s, startDrawing: raw, startTransform: transform };
  }, [transform, axis, resolve]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind === 'pan') return;
    const s = local(e);
    const raw = screenToDrawing(s, transform, axis);
    if (Math.hypot(s.x - d.startScreen.x, s.y - d.startScreen.y) > DRAG_PX) {
      // Dragging leftward on screen is a crossing selection.
      windowSelect(d.startDrawing, raw, s.x < d.startScreen.x, e.shiftKey);
    } else {
      clickDrawing(raw, PICK_PX / transform.scale, e.shiftKey);
    }
    setState((prev) => ({ ...prev, window: null }));
  }, [transform, axis]);

  const onPointerLeave = useCallback(() => setState((prev) => ({ ...prev, cursor: null, snap: null, hoverId: null })), []);

  // Wheel zoom about the cursor (native: React's wheel listener is passive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setTransform((t) => {
        const scale = Math.min(Math.max(t.scale * factor, 0.01), 100000);
        const k = scale / t.scale;
        return { scale, x: sx - (sx - t.x) * k, y: sy - (sy - t.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, setTransform]);

  return { state, handlers: { onPointerMove, onPointerDown, onPointerUp, onPointerLeave } };
}
