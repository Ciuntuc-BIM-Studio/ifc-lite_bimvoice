/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One annotation, drawn in screen space over the drawing: text, leader,
 * dimensions, level marks and hatches (pattern lines clipped to the
 * boundary, even-odd, so islands stay open) — as its styles say
 * (`drafting/styles.ts`: font, arrow, placement, precision…, with the
 * element's own overrides).
 *
 * General rules, whatever the style: text reads left to right, and bottom to
 * top when it runs vertically (`readableDeg`); a dimension's value sits
 * above its line — left of it when the line is vertical — unless the style
 * or the element places it centred (the line broken under it) or below.
 */

import { memo, useId, useMemo } from 'react';
import { dimensionLayout, formatLevel, HATCH_UNIT_M } from '@/drafting/annotation';
import { drawingToScreen, screenSigns, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { findPattern } from '@/drafting/hatch/library';
import { hatchSegments } from '@/drafting/hatch/fill';
import {
  DEFAULT_DIM_STYLE, DEFAULT_TEXT_STYLE, fontFamily, formatDimension, readableDeg,
  type DimStyle, type TextStyle,
} from '@/drafting/styles';
import type { AnnotationShape, Pt } from '@/drafting/types';
import type { HatchPattern } from '@/drafting/hatch/pattern';

/** The styles an annotation is drawn with (resolved from its params). */
export interface AnnotationLook {
  text: TextStyle;
  dim: DimStyle;
}

const DEFAULT_LOOK: AnnotationLook = { text: DEFAULT_TEXT_STYLE, dim: DEFAULT_DIM_STYLE };

interface Props {
  shape: AnnotationShape;
  color: string;
  selected: boolean;
  transform: ViewTransform;
  axis: SectionAxisName;
  extraPatterns: readonly HatchPattern[];
  /** Multiplies stroke widths and minimum sizes: 1 on screen (px), ~0.25 on paper (mm). */
  strokeScale?: number;
  look?: AnnotationLook;
  /** Drawing units per paper millimetre (view scale / 1000; 1 on a sheet). */
  paperUnit?: number;
}

/** A drawing-space direction as a screen angle in degrees, folded to read (left → right, bottom → top). */
function readableAngle(angle: number, axis: SectionAxisName): number {
  const { kx, ky } = screenSigns(axis);
  return readableDeg((Math.atan2(Math.sin(angle) * ky, Math.cos(angle) * kx) * 180) / Math.PI);
}

function polyline(pts: Pt[], t: ViewTransform, axis: SectionAxisName, close = false): string {
  const s = pts.map((p) => drawingToScreen(p, t, axis));
  return s.length ? `M${s.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}${close ? 'Z' : ''}` : '';
}

interface LabelProps {
  at: Pt;
  text: string;
  px: number;
  deg: number;
  color: string;
  style: TextStyle;
  anchor?: 'start' | 'middle';
  /** Baseline shift in the text's own frame, px (negative: up, toward the reader's "above"). */
  shift?: number;
  /** Paper behind the text (a dimension value centred on its line). */
  mask?: boolean;
}

function Label({ at, text, px, deg, color, style, anchor = 'middle', shift = 0, mask = false }: LabelProps) {
  const size = Math.max(px, 1);
  const width = Math.max(1, text.length) * size * 0.6;
  return (
    <g transform={`rotate(${deg.toFixed(2)} ${at.x} ${at.y}) translate(0 ${shift.toFixed(2)})`}>
      {mask ? <rect x={at.x - (anchor === 'middle' ? width / 2 : 0) - size * 0.2} y={at.y - size * 0.85} width={width + size * 0.4} height={size * 1.1} fill="#fff" /> : null}
      <text
        x={at.x}
        y={at.y}
        fill={color}
        fontSize={size}
        fontFamily={fontFamily(style.font)}
        fontWeight={style.bold ? 700 : 400}
        fontStyle={style.italic ? 'italic' : 'normal'}
        textAnchor={anchor}
      >
        {text}
      </text>
    </g>
  );
}

/** An arrow end of the kind the style asks for, at `p` pointing along `dir` (screen). */
function arrowPath(kind: DimStyle['arrow'], p: Pt, dir: Pt, size: number): { d: string; fill: boolean } {
  const ang = Math.atan2(dir.y, dir.x);
  switch (kind) {
    case 'arrow': {
      const back = (da: number) => `${p.x - size * Math.cos(ang + da)} ${p.y - size * Math.sin(ang + da)}`;
      return { d: `M${p.x} ${p.y}L${back(0.3)}L${back(-0.3)}Z`, fill: true };
    }
    case 'dot': {
      const r = size * 0.3;
      return { d: `M${p.x - r} ${p.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`, fill: true };
    }
    case 'none':
      return { d: '', fill: false };
    default: {
      // Architectural tick: 45° across the line.
      const h = size * 0.5;
      const c = Math.cos(ang + Math.PI / 4) * h, s = Math.sin(ang + Math.PI / 4) * h;
      return { d: `M${p.x - c} ${p.y - s}L${p.x + c} ${p.y + s}`, fill: false };
    }
  }
}

function Hatch({ shape, color, t, axis, extraPatterns, k }: { shape: Extract<AnnotationShape, { type: 'hatch' }>; color: string; t: ViewTransform; axis: SectionAxisName; extraPatterns: readonly HatchPattern[]; k: number }) {
  const clipId = useId();
  const pattern = findPattern(shape.pattern, extraPatterns);
  const outline = shape.loops.map((l) => polyline(l, t, axis, true)).join('');
  // Pattern lines are computed in drawing space once per shape, then mapped to the screen.
  const segments = useMemo(
    () => (pattern && !pattern.solid ? hatchSegments(shape.loops, pattern, { scale: shape.scale * HATCH_UNIT_M, angleDeg: shape.angle }).segments : []),
    [shape.loops, shape.scale, shape.angle, pattern],
  );
  if (!pattern || pattern.solid) return <path d={outline} fill={color} fillOpacity={pattern ? 0.85 : 0.15} fillRule="evenodd" stroke={color} strokeWidth={0.75 * k} />;
  const d = segments.map((s) => {
    const a = drawingToScreen(s.a, t, axis);
    const b = drawingToScreen(s.b, t, axis);
    return a.x === b.x && a.y === b.y ? `M${a.x.toFixed(2)} ${a.y.toFixed(2)}h0.01` : `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }).join('');
  return (
    <g>
      <clipPath id={clipId}><path d={outline} clipRule="evenodd" /></clipPath>
      <path d={d} stroke={color} strokeWidth={0.6 * k} strokeLinecap="round" fill="none" clipPath={`url(#${clipId})`} />
      <path d={outline} fill="none" stroke={color} strokeWidth={0.4 * k} strokeOpacity={0.6} />
    </g>
  );
}

export const AnnotationGraphics = memo(function AnnotationGraphics({
  shape, color: base, selected, transform: t, axis, extraPatterns, strokeScale: k = 1, look = DEFAULT_LOOK, paperUnit = 0.1,
}: Props) {
  const s = (p: Pt) => drawingToScreen(p, t, axis);
  if (shape.type === 'hatch') return <Hatch shape={shape} color={selected ? '#2563eb' : base} t={t} axis={axis} extraPatterns={extraPatterns} k={k} />;
  const textColor = selected ? '#2563eb' : look.text.color ?? base;
  const px = shape.height * t.scale;
  /** Paper millimetres → screen px. */
  const mm = (v: number) => v * paperUnit * t.scale;
  switch (shape.type) {
    case 'text':
      return <Label at={s(shape.p)} text={shape.text} px={px} deg={readableAngle(shape.rotation, axis)} color={textColor} style={look.text} anchor="start" />;
    case 'leader': {
      const [tip, next] = [shape.pts[0], shape.pts[1] ?? shape.pts[0]];
      const a = s(tip);
      const b = s(next);
      const end = s(shape.pts[shape.pts.length - 1]);
      const head = arrowPath('arrow', a, { x: a.x - b.x, y: a.y - b.y }, Math.max(mm(look.dim.arrowSize) * 1.2, 4 * k));
      const lineColor = selected ? '#2563eb' : base;
      return (
        <g>
          <path d={polyline(shape.pts, t, axis)} stroke={lineColor} strokeWidth={k} fill="none" />
          <path d={head.d} fill={lineColor} />
          <Label at={{ x: end.x + 3 * k, y: end.y }} text={shape.text} px={px} deg={0} color={textColor} style={look.text} anchor="start" shift={px * 0.35} />
        </g>
      );
    }
    case 'level': {
      const p = s(shape.p);
      const h = Math.max(px, 4 * k);
      const lineColor = selected ? '#2563eb' : base;
      return (
        <g>
          <g stroke={lineColor} fill="none" strokeWidth={k}>
            <path d={`M${p.x} ${p.y}L${p.x - h} ${p.y - h}L${p.x + h} ${p.y - h}Z`} fill={lineColor} fillOpacity={0.25} />
            <path d={`M${p.x - h} ${p.y}L${p.x + h * 5} ${p.y}`} />
          </g>
          <Label at={{ x: p.x + h * 1.3, y: p.y - h * 1.15 }} text={formatLevel(shape.value)} px={px} deg={0} color={textColor} style={look.text} anchor="start" />
        </g>
      );
    }
    default: {
      const dim = look.dim;
      const layout = dimensionLayout(shape, {
        extGap: dim.extGap * paperUnit,
        extOver: dim.extOver * paperUnit,
        format: (m) => formatDimension(m, dim),
      });
      const lineColor = selected ? '#2563eb' : dim.color ?? base;
      const lines = layout.lines.map((l) => polyline([l.a, l.b], t, axis)).join('');
      const size = Math.max(mm(dim.arrowSize), 3 * k);
      const heads = layout.ticks.map((tick) => {
        const p = s(tick.at);
        const q = s({ x: tick.at.x + tick.dir.x, y: tick.at.y + tick.dir.y });
        return arrowPath(dim.arrow, p, { x: q.x - p.x, y: q.y - p.y }, size);
      });
      // Above the line in the text's own (readable) frame: up there is screen-up for a horizontal
      // line and screen-left for a vertical one. Centred breaks the line under the value.
      const gap = mm(dim.textGap);
      const shift = dim.placement === 'centered' ? px * 0.35 : dim.placement === 'below' ? gap + px * 0.8 : -gap;
      return (
        <g>
          <path d={lines} stroke={lineColor} strokeWidth={0.75 * k} fill="none" />
          <path d={heads.filter((h) => !h.fill).map((h) => h.d).join('')} stroke={lineColor} strokeWidth={1.5 * k} fill="none" />
          <path d={heads.filter((h) => h.fill).map((h) => h.d).join('')} fill={lineColor} />
          <Label at={s(layout.textAt)} text={layout.label} px={px} deg={readableAngle(layout.textAngle, axis)} color={selected ? '#2563eb' : look.text.color ?? dim.color ?? base} style={look.text} shift={shift} mask={dim.placement === 'centered'} />
        </g>
      );
    }
  }
});
