/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A road drawing in paper millimetres (`civil/civil-drawings.ts`), each
 * primitive tagged with its pen (DXF layer, weight, line type) so the
 * sheet's PDF / SVG / DXF exports carry it like any viewport; and the hook
 * that lays out the road drawings placed on a sheet.
 */

import { memo, useMemo } from 'react';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import type { ProjectSheet } from '@/project/types';
import { buildCivilDrawing, layoutCivilDrawing, type CivilLayout, type PaperPrim } from '@/civil/civil-drawings';
import { penTags } from '../sheets/dxf-tags';

const FONT = 'ui-sans-serif, system-ui, sans-serif';

function Prim({ p }: { p: PaperPrim }) {
  if (p.kind === 'line') {
    return <line {...penTags(p.pen.layer, p.pen.width, !!p.pen.dashed, p.pen.color)} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.pen.color} strokeWidth={p.pen.width} strokeDasharray={p.pen.dashed ? '2 1' : undefined} />;
  }
  if (p.kind === 'path') {
    const d = p.pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join('') + (p.closed ? 'Z' : '');
    return <path {...penTags(p.pen.layer, p.pen.width, !!p.pen.dashed, p.pen.color)} d={d} fill={p.fill ?? 'none'} fillOpacity={p.fill ? 0.85 : undefined} fillRule="evenodd" stroke={p.pen.color} strokeWidth={p.pen.width} strokeLinejoin="round" />;
  }
  return (
    <text {...penTags('C-ROAD-TEXT', 0.18)} x={p.x} y={p.y} fontSize={p.size} fontFamily={FONT} fill="#000" textAnchor={p.anchor}
      transform={p.rotate ? `rotate(${p.rotate} ${p.x} ${p.y})` : undefined}>
      {p.text}
    </text>
  );
}

/** The drawing with its top-left at (x, y) on the paper. */
export const CivilDrawingGraphic = memo(function CivilDrawingGraphic({ layout, x = 0, y = 0 }: { layout: CivilLayout; x?: number; y?: number }) {
  return (
    <g transform={x || y ? `translate(${x} ${y})` : undefined}>
      {layout.prims.map((p, i) => <Prim key={i} p={p} />)}
    </g>
  );
});

/** The road drawings placed on a sheet, by drawing id, in paper millimetres. */
export function useSheetCivilDrawings(sheet: ProjectSheet): Map<string, CivilLayout> {
  const drawings = useProjectStore((s) => s.civilDrawings);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const models = useViewerStore((s) => s.models);
  return useMemo(() => {
    void mutationVersion; void models;
    const out = new Map<string, CivilLayout>();
    for (const vp of sheet.viewports ?? []) {
      const d = drawings?.find((x) => x.id === vp.viewId);
      if (!d || out.has(d.id)) continue;
      const built = buildCivilDrawing(d);
      if ('prims' in built) out.set(d.id, layoutCivilDrawing(built, d.scale));
    }
    return out;
  }, [sheet.viewports, drawings, mutationVersion, models]);
}
