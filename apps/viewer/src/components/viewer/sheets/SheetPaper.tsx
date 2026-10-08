/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A sheet drawn in paper millimetres: frame, title block and viewports.
 * The same SVG is shown on screen (scaled by CSS) and exported, so the
 * export is exactly what the user sees, at true scale.
 *
 * A viewport draws its view's generated drawing with pen weights by line
 * category (cut 0.5 mm, seen 0.25 mm, hidden 0.18 mm dashed), cut areas
 * toned, then the view's drafted geometry and annotations, clipped to the
 * viewport box.
 */

import { forwardRef, memo, useMemo } from 'react';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { useTranslation } from '@/i18n';
import type { SectionAxisName, ViewTransform } from '@/drafting/frame';
import { isGeometry, type DraftEntity, type DraftLayer, type DraftShape } from '@/drafting/types';
import type { HatchPattern } from '@/drafting/hatch/pattern';
import { FRAME_MARGIN_MM, mmPerMetre, paperOf, TITLE_BLOCK_MM, viewportBox } from '@/project/sheets';
import type { ProjectSheet, ProjectView, SheetViewport } from '@/project/types';
import { shapePath } from '../drafting/DraftOverlay';
import { AnnotationGraphics } from '../drafting/AnnotationGraphics';
import { PEN, viewportPens } from './viewport-pens';

const AXIS_NAME = { y: 'down', z: 'front', x: 'side' } as const;
const LABEL_MM = 3.5;

export interface ViewportContent {
  view: ProjectView | undefined;
  drawing: Drawing2D | null;
  drafts: DraftEntity[];
  /** Plan symbols (door swings, windows), drawing units. */
  symbols?: DraftShape[];
}

interface SheetPaperProps {
  sheet: ProjectSheet;
  projectName: string;
  content: (viewport: SheetViewport) => ViewportContent;
  layers: readonly DraftLayer[];
  extraPatterns: readonly HatchPattern[];
  selectedViewportId: string | null;
  /** On-screen pixels per millimetre; the export sets real `mm` units instead. */
  pxPerMm: number;
}

/** The viewport's drawing → paper transform: the chosen (or drawing's) centre at the viewport centre. */
export function viewportTransform(vp: SheetViewport, drawing: Drawing2D | null, axis: SectionAxisName): ViewTransform {
  const s = mmPerMetre(vp);
  const b = drawing?.bounds;
  const c = vp.center ?? (b ? { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 } : { x: 0, y: 0 });
  const kx = axis === 'side' ? -1 : 1;
  const ky = axis !== 'down' ? -1 : 1;
  return { scale: s, x: vp.x - c.x * kx * s, y: vp.y - c.y * ky * s };
}

const ViewportGraphic = memo(function ViewportGraphic({ vp, content, layers, extraPatterns, selected }: {
  vp: SheetViewport; content: ViewportContent; layers: readonly DraftLayer[]; extraPatterns: readonly HatchPattern[]; selected: boolean;
}) {
  const { t: tr } = useTranslation();
  const { view, drawing, drafts } = content;
  const axis: SectionAxisName = drawing ? AXIS_NAME[drawing.config.plane.axis] : 'down';
  const t = viewportTransform(vp, drawing, axis);
  const pens = useMemo(
    () => (drawing ? viewportPens(drawing, view?.graphics, viewportTransform(vp, drawing, axis), axis, extraPatterns) : []),
    [drawing, view?.graphics, vp, axis, extraPatterns],
  );
  const box = viewportBox(vp, drawing?.bounds ?? null);
  const left = vp.x - box.width / 2;
  const top = vp.y - box.height / 2;
  const clipId = `vp-${vp.id}`;
  const layerColor = new Map(layers.map((l) => [l.id, l.visible ? l.color : null]));
  return (
    <g data-viewport-id={vp.id}>
      <clipPath id={clipId}><rect x={left} y={top} width={box.width} height={box.height} /></clipPath>
      <g clipPath={`url(#${clipId})`}>
        {pens.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill ?? 'none'} fillRule="evenodd" stroke={p.stroke ?? 'none'} strokeWidth={p.width} strokeDasharray={p.dash} strokeLinejoin="round" />
        ))}
        {content.symbols?.length ? (
          <path d={content.symbols.map((s) => shapePath(s, t, axis)).join('')} stroke="#000" strokeWidth={PEN.hatch} fill="none" />
        ) : null}
        {drafts.map((e) => {
          const color = layerColor.get(e.layerId);
          if (color === null) return null;
          return isGeometry(e.shape)
            ? <path key={e.id} d={shapePath(e.shape, t, axis)} stroke={color ?? '#000'} strokeWidth={PEN.seen} fill="none" />
            : <AnnotationGraphics key={e.id} shape={e.shape} color={color ?? '#000'} selected={false} transform={t} axis={axis} extraPatterns={extraPatterns} strokeScale={0.25} />;
        })}
      </g>
      <rect
        x={left} y={top} width={box.width} height={box.height} fill="transparent"
        stroke={selected ? '#2563eb' : 'transparent'} strokeWidth={0.4} strokeDasharray={selected ? '3 2' : undefined}
        data-export-ignore={selected ? 'true' : undefined}
      />
      <text x={left} y={top + box.height + LABEL_MM + 1.5} fontSize={LABEL_MM} fontFamily="ui-sans-serif, system-ui, sans-serif" fill="#000">
        {tr('sheets.viewportLabel', { name: view?.name ?? '?', scale: vp.scale })}
      </text>
    </g>
  );
});

function TitleBlock({ sheet, projectName, w, h }: { sheet: ProjectSheet; projectName: string; w: number; h: number }) {
  const { t } = useTranslation();
  const x = w - FRAME_MARGIN_MM - TITLE_BLOCK_MM.w;
  const y = h - FRAME_MARGIN_MM - TITLE_BLOCK_MM.h;
  const fields = sheet.titleBlock ?? {};
  const scales = [...new Set((sheet.viewports ?? []).map((v) => v.scale))];
  const scaleText = scales.length === 1 ? `1:${scales[0]}` : scales.length === 0 ? '—' : t('sheets.asIndicated');
  const rows: [string, string][] = [
    [t('sheets.tb.project'), fields.project || projectName],
    [t('sheets.tb.title'), sheet.name],
    [t('sheets.tb.drawnBy'), fields.drawnBy ?? ''],
    [t('sheets.tb.date'), fields.date ?? ''],
  ];
  const rowH = TITLE_BLOCK_MM.h / 5;
  const font = 'ui-sans-serif, system-ui, sans-serif';
  return (
    <g>
      <rect x={x} y={y} width={TITLE_BLOCK_MM.w} height={TITLE_BLOCK_MM.h} fill="#fff" stroke="#000" strokeWidth={0.5} />
      {rows.map(([label, value], i) => (
        <g key={label}>
          <line x1={x} y1={y + rowH * (i + 1)} x2={x + TITLE_BLOCK_MM.w - 50} y2={y + rowH * (i + 1)} stroke="#000" strokeWidth={0.18} />
          <text x={x + 2} y={y + rowH * i + 3.2} fontSize={2} fontFamily={font} fill="#52525b">{label}</text>
          <text x={x + 2} y={y + rowH * i + 8} fontSize={3.5} fontFamily={font} fill="#000">{value}</text>
        </g>
      ))}
      <line x1={x + TITLE_BLOCK_MM.w - 50} y1={y} x2={x + TITLE_BLOCK_MM.w - 50} y2={y + TITLE_BLOCK_MM.h} stroke="#000" strokeWidth={0.35} />
      <text x={x + TITLE_BLOCK_MM.w - 48} y={y + 4} fontSize={2} fontFamily={font} fill="#52525b">{t('sheets.tb.number')}</text>
      <text x={x + TITLE_BLOCK_MM.w - 48} y={y + 18} fontSize={10} fontWeight={700} fontFamily={font} fill="#000">{sheet.number}</text>
      <text x={x + TITLE_BLOCK_MM.w - 48} y={y + 32} fontSize={2} fontFamily={font} fill="#52525b">{t('sheets.tb.scale')}</text>
      <text x={x + TITLE_BLOCK_MM.w - 48} y={y + 40} fontSize={4.5} fontFamily={font} fill="#000">{scaleText}</text>
    </g>
  );
}

export const SheetPaper = forwardRef<SVGSVGElement, SheetPaperProps>(function SheetPaper(
  { sheet, projectName, content, layers, extraPatterns, selectedViewportId, pxPerMm }, ref,
) {
  const { w, h } = paperOf(sheet);
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={w * pxPerMm} height={h * pxPerMm} viewBox={`0 0 ${w} ${h}`} className="block bg-white shadow-lg">
      <rect x={0} y={0} width={w} height={h} fill="#fff" />
      <rect x={FRAME_MARGIN_MM} y={FRAME_MARGIN_MM} width={w - FRAME_MARGIN_MM * 2} height={h - FRAME_MARGIN_MM * 2} fill="none" stroke="#000" strokeWidth={0.7} />
      {(sheet.viewports ?? []).map((vp) => (
        <ViewportGraphic key={vp.id} vp={vp} content={content(vp)} layers={layers} extraPatterns={extraPatterns} selected={vp.id === selectedViewportId} />
      ))}
      <TitleBlock sheet={sheet} projectName={projectName} w={w} h={h} />
    </svg>
  );
});
