/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The drafting layer over the Drawing canvas: drafted entities, selection,
 * the running command's preview, the snap marker and the selection window,
 * all in screen space through the canvas's own transform (`drafting/frame`).
 */

import { memo, useMemo } from 'react';
import { layerPen, layerShows, lookOf, type LayerGroup } from '@/drafting/styles';
import { moveGrip, type Grip } from '@/drafting/grips';
import { useProjectStore } from '@/project/project-store';
import { drawingToScreen, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { isGeometry, type DraftEntity, type DraftLayer, type DraftShape, type Pt, type SnapHit } from '@/drafting/types';
import { entitySkeleton } from '@/drafting/annotation';
import type { HatchPattern } from '@/drafting/hatch/pattern';
import { AnnotationGraphics } from './AnnotationGraphics';

const ARC_STEP = Math.PI / 48;

function arcPoints(c: Pt, r: number, start: number, end: number): Pt[] {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(sweep / ARC_STEP));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = start + (sweep * i) / steps;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/** The shape as an SVG path in screen coordinates. */
export function shapePath(shape: DraftShape, t: ViewTransform, axis: SectionAxisName): string {
  const pts = (list: Pt[], close: boolean) => {
    const s = list.map((p) => drawingToScreen(p, t, axis));
    return `M${s.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}${close ? 'Z' : ''}`;
  };
  switch (shape.type) {
    case 'line':
      return pts([shape.a, shape.b], false);
    case 'polyline':
      return pts(shape.pts, shape.closed);
    case 'circle':
      return pts(arcPoints(shape.c, shape.r, 0, Math.PI * 2), true);
    case 'arc':
      return pts(arcPoints(shape.c, shape.r, shape.start, shape.end), false);
  }
}

interface DraftOverlayProps {
  entities: readonly DraftEntity[];
  layers: readonly DraftLayer[];
  selection: ReadonlySet<string>;
  hoverId: string | null;
  preview: readonly DraftShape[];
  snap: SnapHit | null;
  cursor: Pt | null;
  window: { a: Pt; b: Pt } | null;
  /** Outlines of the selected model elements. */
  highlight: readonly DraftShape[];
  /** User-imported hatch patterns (built-ins are always available). */
  extraPatterns: readonly HatchPattern[];
  transform: ViewTransform;
  axis: SectionAxisName;
  /** Drawing units per paper millimetre (view scale / 1000; 1 on a sheet). */
  paperUnit?: number;
  /** Layers the view hides. */
  hiddenLayers?: readonly string[];
  /** The selected entities' grips, and the one being dragged. */
  grips?: readonly Grip[];
  gripDrag?: { grip: Grip; at: Pt } | null;
}

function SnapMarker({ snap, t, axis }: { snap: SnapHit; t: ViewTransform; axis: SectionAxisName }) {
  const p = drawingToScreen(snap.point, t, axis);
  const s = 6;
  const common = { fill: 'none', stroke: '#f59e0b', strokeWidth: 2 };
  switch (snap.mode) {
    case 'endpoint':
      return <rect x={p.x - s} y={p.y - s} width={s * 2} height={s * 2} {...common} />;
    case 'midpoint':
      return <path d={`M${p.x} ${p.y - s}L${p.x + s} ${p.y + s}L${p.x - s} ${p.y + s}Z`} {...common} />;
    case 'center':
      return <circle cx={p.x} cy={p.y} r={s} {...common} />;
    case 'quadrant':
      return <path d={`M${p.x} ${p.y - s}L${p.x + s} ${p.y}L${p.x} ${p.y + s}L${p.x - s} ${p.y}Z`} {...common} />;
    case 'intersection':
      return <path d={`M${p.x - s} ${p.y - s}L${p.x + s} ${p.y + s}M${p.x + s} ${p.y - s}L${p.x - s} ${p.y + s}`} {...common} />;
    case 'perpendicular':
      return <path d={`M${p.x - s} ${p.y - s}L${p.x - s} ${p.y + s}L${p.x + s} ${p.y + s}M${p.x - s} ${p.y}L${p.x} ${p.y}L${p.x} ${p.y + s}`} {...common} />;
    default:
      return <path d={`M${p.x - s} ${p.y - s}L${p.x + s} ${p.y - s}L${p.x - s} ${p.y + s}L${p.x + s} ${p.y + s}Z`} {...common} />;
  }
}

const NO_GROUPS: LayerGroup[] = [];
const NO_GRIPS: Grip[] = [];

/** The dragged entity as it will be, drawn over the original. */
function GripPreview({ gripDrag, entities, t, axis, look, paperUnit, extraPatterns }: {
  gripDrag: { grip: Grip; at: Pt }; entities: readonly DraftEntity[]; t: ViewTransform; axis: SectionAxisName;
  look: (e: DraftEntity) => ReturnType<typeof lookOf>; paperUnit: number; extraPatterns: readonly HatchPattern[];
}) {
  const entity = entities.find((e) => e.id === gripDrag.grip.id);
  if (!entity) return null;
  const moved = moveGrip(entity.shape, gripDrag.grip.key, gripDrag.at);
  return isGeometry(moved)
    ? <path d={shapePath(moved, t, axis)} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="5 3" />
    : <AnnotationGraphics shape={moved} color="#2563eb" selected transform={t} axis={axis} extraPatterns={extraPatterns} look={look(entity)} paperUnit={paperUnit} />;
}

export const DraftOverlay = memo(function DraftOverlay(props: DraftOverlayProps) {
  const { entities, layers, selection, hoverId, preview, snap, cursor, window, highlight, extraPatterns, transform: t, axis, paperUnit = 0.1, hiddenLayers, grips = NO_GRIPS, gripDrag = null } = props;
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const textStyles = useProjectStore((s) => s.textStyles);
  const dimStyles = useProjectStore((s) => s.dimStyles);
  const groups = useProjectStore((s) => s.layerGroups) ?? NO_GROUPS;
  const book = useMemo(() => ({ textStyles: textStyles ?? [], dimStyles: dimStyles ?? [] }), [textStyles, dimStyles]);
  /** Paper millimetres → screen px. */
  const mm = paperUnit * t.scale;
  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
      {highlight.length > 0 ? (
        <path d={highlight.map((s) => shapePath(s, t, axis)).join('')} fill="rgba(37,99,235,0.12)" fillRule="evenodd" stroke="#2563eb" strokeWidth={2} />
      ) : null}
      {entities.map((e) => {
        const layer = layerById.get(e.layerId);
        if (layer && !layerShows(layer, groups, { view: hiddenLayers })) return null;
        const isSelected = selection.has(e.id);
        const isHover = hoverId === e.id && !isSelected;
        const color = layer?.color ?? '#18181b';
        if (!isGeometry(e.shape)) {
          return (
            <g key={e.id}>
              <AnnotationGraphics shape={e.shape} color={color} selected={isSelected} transform={t} axis={axis} extraPatterns={extraPatterns} look={lookOf(book, e.params)} paperUnit={paperUnit} />
              {isHover || isSelected ? (
                <path d={entitySkeleton(e.shape).map((s) => shapePath(s, t, axis)).join('')} fill="none" stroke={isSelected ? '#2563eb' : '#60a5fa'} strokeWidth={1} strokeDasharray="4 3" />
              ) : null}
            </g>
          );
        }
        // The layer's pen at the view's scale: weight and line type in paper mm, never thinner than a pixel.
        const pen = layerPen(layer);
        const dash = pen.dash.length ? pen.dash.map((d) => Math.max(d * mm, 2)).join(' ') : undefined;
        return (
          <path
            key={e.id}
            d={shapePath(e.shape, t, axis)}
            fill="none"
            stroke={isSelected ? '#2563eb' : isHover ? '#60a5fa' : color}
            strokeWidth={isSelected || isHover ? 2 : Math.max(pen.width * mm, 1)}
            strokeDasharray={isSelected ? '6 3' : dash}
          />
        );
      })}
      {gripDrag ? <GripPreview gripDrag={gripDrag} entities={entities} t={t} axis={axis} look={(e) => lookOf(book, e.params)} paperUnit={paperUnit} extraPatterns={extraPatterns} /> : null}
      {grips.map((g) => {
        const p = drawingToScreen(g.at, t, axis);
        const active = gripDrag?.grip.id === g.id && gripDrag.grip.key === g.key;
        return <rect key={`${g.id}:${g.key}`} x={p.x - 4} y={p.y - 4} width={8} height={8} fill={active ? '#2563eb' : '#fff'} stroke="#2563eb" strokeWidth={1.5} />;
      })}
      {preview.map((shape, i) => (
        <path key={`p${i}`} d={shapePath(shape, t, axis)} fill="none" stroke="#2563eb" strokeWidth={1.25} strokeDasharray="4 3" />
      ))}
      {window ? <SelectionWindow window={window} t={t} axis={axis} /> : null}
      {snap ? <SnapMarker snap={snap} t={t} axis={axis} /> : null}
      {cursor ? <Crosshair p={drawingToScreen(cursor, t, axis)} /> : null}
    </svg>
  );
});

function SelectionWindow({ window, t, axis }: { window: { a: Pt; b: Pt }; t: ViewTransform; axis: SectionAxisName }) {
  const a = drawingToScreen(window.a, t, axis);
  const b = drawingToScreen(window.b, t, axis);
  // Dragged leftward on screen = crossing (green, dashed); rightward = window (blue).
  const crossing = b.x < a.x;
  return (
    <rect
      x={Math.min(a.x, b.x)}
      y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)}
      height={Math.abs(b.y - a.y)}
      fill={crossing ? 'rgba(34,197,94,0.08)' : 'rgba(37,99,235,0.08)'}
      stroke={crossing ? '#16a34a' : '#2563eb'}
      strokeDasharray={crossing ? '5 3' : undefined}
    />
  );
}

function Crosshair({ p }: { p: Pt }) {
  const s = 14;
  return (
    <g stroke="#52525b" strokeWidth={1}>
      <line x1={p.x - s} y1={p.y} x2={p.x + s} y2={p.y} />
      <line x1={p.x} y1={p.y - s} x2={p.x} y2={p.y + s} />
      <rect x={p.x - 3} y={p.y - 3} width={6} height={6} fill="none" />
    </g>
  );
}
