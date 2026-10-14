/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The outline of a selected slab (or flat roof, plate, space) on a floor-plan
 * tab, editable after it is placed, as a roof's outline is: drag a corner to
 * move it, drag an edge's middle to add a corner there, double-click a corner
 * to remove it. Release writes the new outline in one undo step
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
import type { Vec2 } from '@/lib/snap/types';
import type { ModelHandles } from './ModelHandlesLayer';

interface Drag {
  /** Corner being moved; for an edge-middle drag, the new corner's index. */
  index: number;
  outline: Vec2[];
}

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
  const host = useRef<SVGSVGElement>(null);
  const { map } = handles;
  if (!slab || !map || handles.idle) return null;

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
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag(next);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const p = toLocal(e);
    setDrag({ ...drag, outline: drag.outline.map((q, i) => (i === drag.index ? p : q)) });
  };
  const end = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const done = drag;
    setDrag(null);
    const moved = done.outline[done.index];
    const was = slab.outline[done.index];
    // A click without a move changes nothing (an edge middle not dragged adds no corner).
    if (done.outline.length === slab.outline.length && was && Math.hypot(moved[0] - was[0], moved[1] - was[1]) < 1e-6) return;
    apply(done.outline);
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
      {slab.outline.map((p, i) => {
        const q = slab.outline[(i + 1) % slab.outline.length];
        const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const [x, y] = S(mid);
        return (
          <circle key={`m${i}`} cx={x} cy={y} r={4} fill="#fff" stroke="#2563eb" strokeWidth={1.2} className="pointer-events-auto cursor-copy"
            onPointerDown={(e) => {
              const outline = [...slab.outline];
              outline.splice(i + 1, 0, mid);
              begin(e, { index: i + 1, outline });
            }}>
            <title>{t('slabOutline.addCorner')}</title>
          </circle>
        );
      })}
      {shown.map((p, i) => {
        const [x, y] = S(p);
        return (
          <rect key={`v${i}`} x={x - 5} y={y - 5} width={10} height={10} fill="#2563eb" stroke="#fff" strokeWidth={1}
            className="pointer-events-auto cursor-move"
            onPointerDown={(e) => { if (!drag) begin(e, { index: i, outline: [...slab.outline] }); }}
            onDoubleClick={(e) => remove(e, i)}>
            <title>{t('slabOutline.corner')}</title>
          </rect>
        );
      })}
    </svg>
  );
}
