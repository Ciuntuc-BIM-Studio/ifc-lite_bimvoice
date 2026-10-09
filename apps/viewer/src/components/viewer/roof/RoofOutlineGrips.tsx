/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The outline of a selected roof that owns it (drawn with ROOF, not linked
 * to a drafted contour), editable on the plan: drag a corner to move it,
 * drag an edge's middle to add a corner there, double-click a corner to
 * remove it. The roof regenerates on release, its rules following its edges
 * (a split edge's halves keep its rule; removing a corner keeps the rule of
 * the edge before it); part overrides stay with their parts.
 */

import { useRef, useState } from 'react';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { RoofEdgeRule } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { toast } from '@/components/ui/toast';
import { drawingToScreen, screenToDrawing, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import type { ProjectView } from '@/project/types';
import type { PlanRoof } from '@/project/roof-plan';
import { reshapeRoofSystem } from '@/project/roof-system-element';

interface Drag {
  /** Corner index being moved; for an edge-middle drag, the new corner's index. */
  index: number;
  outline: Pt[];
  rules: RoofEdgeRule[];
}

export function RoofOutlineGrips({ roof, view, plane, transform, axis }: {
  roof: PlanRoof; view: ProjectView; plane: SectionPlaneConfig; transform: ViewTransform; axis: SectionAxisName;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<Drag | null>(null);
  const host = useRef<SVGSVGElement>(null);
  const S = (p: Pt) => drawingToScreen(p, transform, axis);
  const toDrawing = (e: React.PointerEvent) => {
    const rect = host.current?.getBoundingClientRect();
    return screenToDrawing({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }, transform, axis);
  };
  const apply = (outline: Pt[], rules: RoofEdgeRule[]) => {
    const result = reshapeRoofSystem(roof, view, plane, outline, rules);
    if (!result.ok) toast.error(t('roof.problem', { reason: result.error }));
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
    const p = toDrawing(e);
    setDrag({ ...drag, outline: drag.outline.map((q, i) => (i === drag.index ? p : q)) });
  };
  const end = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const done = drag;
    setDrag(null);
    const moved = done.outline[done.index];
    const was = roof.outline[done.index];
    // A click without a move changes nothing (an edge middle not dragged adds no corner).
    if (done.outline.length === roof.outline.length && was && Math.hypot(moved.x - was.x, moved.y - was.y) < 1e-6) return;
    apply(done.outline, done.rules);
  };
  const remove = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    if (roof.outline.length <= 3) return;
    apply(roof.outline.filter((_, k) => k !== i), roof.spec.rules.filter((_, k) => k !== i));
  };

  const shown = drag?.outline ?? roof.outline;
  const n = shown.length;
  const path = shown.map((p, i) => `${i ? 'L' : 'M'}${S(p).x.toFixed(1)},${S(p).y.toFixed(1)}`).join('') + 'Z';
  return (
    <svg ref={host} data-roof-grips className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"
      onPointerMove={move} onPointerUp={end}>
      <path d={path} fill="none" stroke="#2563eb" strokeWidth={1.4} strokeDasharray={drag ? '5 3' : undefined} />
      {roof.outline.map((p, i) => {
        const q = roof.outline[(i + 1) % roof.outline.length];
        const m = S({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
        return (
          <circle key={`m${i}`} cx={m.x} cy={m.y} r={4} fill="#fff" stroke="#2563eb" strokeWidth={1.2} className="pointer-events-auto cursor-copy"
            onPointerDown={(e) => {
              const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
              const rules = [...roof.spec.rules];
              rules.splice(i + 1, 0, { ...roof.spec.rules[i] });
              const outline = [...roof.outline];
              outline.splice(i + 1, 0, mid);
              begin(e, { index: i + 1, outline, rules });
            }} />
        );
      })}
      {shown.map((p, i) => {
        const s = S(p);
        return (
          <rect key={`v${i}`} x={s.x - 5} y={s.y - 5} width={10} height={10} fill="#2563eb" stroke="#fff" strokeWidth={1}
            className={`pointer-events-auto ${n > 3 ? 'cursor-move' : 'cursor-move'}`}
            onPointerDown={(e) => { if (!drag) begin(e, { index: i, outline: [...roof.outline], rules: [...roof.spec.rules] }); }}
            onDoubleClick={(e) => remove(e, i)} />
        );
      })}
    </svg>
  );
}
