/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The outline of a selected slab (or flat roof, plate, space) on a floor-plan
 * tab, editable after it is placed: drag a corner to move it, drag a side's
 * middle to push that side square to itself (its neighbours keep their
 * direction; a side cut with KNIFE moves only the piece dragged, with a step
 * at the cut — `drafting/edge-offset.ts`), double-click a corner to remove
 * it. With KNIFE running, a click on a side cuts it there (a new corner).
 * Release writes the new outline in one undo step
 * (`reshapeSlabOutlineIn`), and the slab re-meshes with its openings re-cut.
 * Only a slab that is a vertical extrusion of its outline, on the plan's
 * storey, of a model the user may edit, shows them.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { resolveEntityRef } from '@/store/resolveEntityRef';
import { modelEditTarget } from '@/store/slices/mutation-modelling-records';
import { reshapeSlabOutlineIn } from '@/store/slices/mutation-slab-outline';
import { getModelLengthUnitScale } from '@/lib/length-unit-scale';
import { resolveSlabEditChain } from '@/lib/slab-edit';
import { elementStoreyId } from '@/lib/commands/modeling/workplane';
import { ensureEditMode } from '@/project/edit-mode';
import { capturePointer } from '@/lib/pointer-capture';
import type { Vec2 } from '@/lib/snap/types';
import type { ModelHandles } from './ModelHandlesLayer';
import type { Pt } from '@/drafting/types';
import { edgeFrame, edgeOffsetFor, knifeAt, offsetEdge } from '@/drafting/edge-offset';
import { useDraftingSession } from '@/drafting/session';

interface Drag {
  /** The corner being moved, or the side being pushed. */
  kind: 'corner' | 'side';
  index: number;
  outline: Vec2[];
}

const toPt = ([x, y]: Vec2): Pt => ({ x, y });
const toVec = (p: Pt): Vec2 => [p.x, p.y];

/** The selected slab's outline (storey-local metres), or null when it has none to edit here. */
function useSelectedSlab(handles: ModelHandles): { modelId: string; expressId: number; outline: Vec2[] } | null {
  const selectedId = useViewerStore((s) => s.selectedEntityId);
  const selectedIds = useViewerStore((s) => s.selectedEntityIds);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const { target } = handles;
  return useMemo(() => {
    void mutationVersion;
    if (!target || selectedId === null || selectedIds.size > 1) return null;
    const s = useViewerStore.getState();
    const { modelId, expressId } = resolveEntityRef(selectedId);
    if (modelId !== target.modelId || !s.canCollabEdit() || elementStoreyId(s, modelId, expressId) !== target.storeyId) return null;
    const edit = modelEditTarget(s, modelId);
    if (!edit) return null;
    const chain = resolveSlabEditChain(edit.dataStore, edit.view, edit.editor, expressId, getModelLengthUnitScale(edit.dataStore));
    if (!chain || chain.baseElevation === null || chain.footprint.length < 3) return null;
    return { modelId, expressId, outline: chain.footprint.map(([x, y]): Vec2 => [x, y]) };
  }, [target, selectedId, selectedIds, mutationVersion]);
}

export function SlabOutlineGrips({ handles }: { handles: ModelHandles }) {
  const { t } = useTranslation();
  const slab = useSelectedSlab(handles);
  const [drag, setDrag] = useState<Drag | null>(null);
  const knife = useDraftingSession((st) => st.commandId === 'knife');
  const host = useRef<SVGSVGElement>(null);
  const { map } = handles;
  // While a command runs the grips stand down, KNIFE excepted: it cuts the outline.
  if (!slab || !map || (handles.idle && !knife)) return null;

  const S = (p: Vec2) => map.toScreen(p);
  const toLocal = (e: React.PointerEvent): Vec2 => {
    const rect = host.current?.getBoundingClientRect();
    return map.toLocal({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  };
  const apply = (outline: Vec2[]) => {
    if (!ensureEditMode()) return;
    const result = reshapeSlabOutlineIn(useViewerStore, slab.modelId, slab.expressId, outline.map(([x, y]): [number, number] => [x, y]));
    if (!result.ok) toast.error(t('slabOutline.problem', { reason: result.reason }));
  };
  const begin = (e: React.PointerEvent, next: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    capturePointer(e.target as Element, e.pointerId);
    setDrag(next);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const p = toLocal(e);
    if (drag.kind === 'corner') { setDrag({ ...drag, outline: slab.outline.map((q, i) => (i === drag.index ? p : q)) }); return; }
    const pts = slab.outline.map(toPt);
    setDrag({ ...drag, outline: offsetEdge(pts, drag.index, edgeOffsetFor(pts, drag.index, toPt(p)), true).map(toVec) });
  };
  const end = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const done = drag;
    setDrag(null);
    // A click without a move changes nothing.
    const same = done.outline.length === slab.outline.length && done.outline.every((q, i) => Math.hypot(q[0] - slab.outline[i][0], q[1] - slab.outline[i][1]) < 1e-6);
    if (!same) apply(done.outline);
  };
  const cut = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const next = knifeAt(slab.outline.map(toPt), toPt(toLocal(e)), true);
    if (next) apply(next.map(toVec));
  };
  const remove = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    if (slab.outline.length > 3) apply(slab.outline.filter((_, k) => k !== i));
  };

  const shown = drag?.outline ?? slab.outline;
  const path = shown.map((p, i) => { const [x, y] = S(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + 'Z';
  return (
    <svg ref={host} data-slab-grips className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"
      onPointerMove={move} onPointerUp={end}>
      <path d={path} fill="none" stroke="#2563eb" strokeWidth={1.4} strokeDasharray={drag ? '5 3' : undefined} />
      {knife ? slab.outline.map((p, i) => {
        // With KNIFE running, each side is a wide invisible target: a click cuts it there.
        const [x1, y1] = S(p), [x2, y2] = S(slab.outline[(i + 1) % slab.outline.length]);
        return <line key={`k${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} className="pointer-events-auto cursor-crosshair" onPointerDown={cut}><title>{t('slabOutline.knife')}</title></line>;
      }) : null}
      {!knife ? slab.outline.map((_, i) => {
        // Every side's grip stays mounted through a drag: the one pressed holds the pointer capture,
        // and the drag's moves and release bubble up to this layer only from it. The others just fade.
        const [x, y] = S(toVec(edgeFrame(slab.outline.map(toPt), i).mid));
        const pressed = drag?.kind === 'side' && drag.index === i;
        return (
          <path key={`m${i}`} d={`M${x} ${y - 5}L${x + 5} ${y}L${x} ${y + 5}L${x - 5} ${y}Z`} fill={pressed ? '#2563eb' : '#fff'} stroke="#2563eb" strokeWidth={1.2}
            opacity={drag && !pressed ? 0 : 1} className="pointer-events-auto cursor-move"
            onPointerDown={(e) => { if (!drag) begin(e, { kind: 'side', index: i, outline: [...slab.outline] }); }}>
            <title>{t('slabOutline.pushSide')}</title>
          </path>
        );
      }) : null}
      {shown.map((p, i) => {
        const [x, y] = S(p);
        return (
          <rect key={`v${i}`} x={x - 5} y={y - 5} width={10} height={10} fill="#2563eb" stroke="#fff" strokeWidth={1}
            className="pointer-events-auto cursor-move"
            onPointerDown={(e) => { if (!drag && !knife) begin(e, { kind: 'corner', index: i, outline: [...slab.outline] }); }}
            onDoubleClick={(e) => remove(e, i)}>
            <title>{t('slabOutline.corner')}</title>
          </rect>
        );
      })}
    </svg>
  );
}
