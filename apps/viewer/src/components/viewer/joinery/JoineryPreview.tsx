/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Live drawings of the type being configured, from the same symbol engine
 * the plans, sheets and the joinery schedule use (`joinery/symbols.ts`):
 * the interior elevation (click a panel to edit it), the exterior elevation,
 * plan, section, and an isometric view of the very boxes the IFC body is
 * built from.
 */

import { useMemo } from 'react';
import { useOpeningConvention } from '@/joinery/opening-convention';
import { joineryBoxes, normalisedPanels, panelRect, type JoineryBox, type JoinerySpec } from '@ifc-lite/create';
import { elevationSymbol, planSymbol, sectionSymbol, strokeBounds, type JoineryStroke } from '@/joinery/symbols';

const WEIGHT: Record<JoineryStroke['weight'], number> = { cut: 1.6, outline: 1, thin: 0.6 };

interface Fit {
  scale: number;
  ox: number;
  oy: number;
}

/** Scale and offset that fit `bounds` (y up) into a `w × h` box with a margin. */
function fit(b: { min: { x: number; y: number }; max: { x: number; y: number } }, w: number, h: number, margin = 10): Fit {
  const bw = Math.max(b.max.x - b.min.x, 1e-6), bh = Math.max(b.max.y - b.min.y, 1e-6);
  const scale = Math.min((w - 2 * margin) / bw, (h - 2 * margin) / bh);
  return { scale, ox: (w - bw * scale) / 2 - b.min.x * scale, oy: (h + bh * scale) / 2 + b.min.y * scale };
}

function strokePath(s: JoineryStroke, f: Fit): string {
  return s.pts.map((p, i) => `${i ? 'L' : 'M'}${(f.ox + p.x * f.scale).toFixed(1)},${(f.oy - p.y * f.scale).toFixed(1)}`).join('') + (s.closed ? 'Z' : '');
}

function Strokes({ strokes, f }: { strokes: readonly JoineryStroke[]; f: Fit }) {
  return (
    <>
      {strokes.map((s, i) => (
        <path key={i} d={strokePath(s, f)} fill="none" stroke="currentColor" strokeWidth={WEIGHT[s.weight]} strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" />
      ))}
    </>
  );
}

interface DrawingProps {
  strokes: readonly JoineryStroke[];
  label: string;
  width: number;
  height: number;
}

export function JoineryDrawing({ strokes, label, width, height }: DrawingProps) {
  const f = useMemo(() => fit(strokeBounds(strokes), width, height), [strokes, width, height]);
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-1 text-zinc-900 dark:border-zinc-700">
      <svg width={width} height={height} aria-hidden="true"><Strokes strokes={strokes} f={f} /></svg>
      <figcaption className="text-center text-2xs text-zinc-500">{label}</figcaption>
    </figure>
  );
}

interface ElevationProps {
  spec: JoinerySpec;
  label: string;
  selected: { col: number; row: number } | null;
  onSelect: (cell: { col: number; row: number }) => void;
  width: number;
  height: number;
}

/** The interior elevation, its panels clickable. */
export function JoineryElevation({ spec, label, selected, onSelect, width, height }: ElevationProps) {
  const convention = useOpeningConvention();
  const strokes = useMemo(() => elevationSymbol(spec, { hardware: true, convention }), [spec, convention]);
  const f = useMemo(() => fit(strokeBounds(strokes), width, height), [strokes, width, height]);
  const panels = useMemo(() => normalisedPanels(spec), [spec]);
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-1 text-zinc-900 dark:border-zinc-700">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true" className="absolute inset-0"><Strokes strokes={strokes} f={f} /></svg>
        {panels.map((p, i) => {
          const r = panelRect(spec, p);
          const on = selected?.col === p.col && selected.row === p.row;
          return (
            <button
              key={`${p.col}:${p.row}`} type="button" aria-label={`${label} · ${i + 1}`} aria-pressed={on}
              className={`absolute rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'bg-primary/20' : 'bg-sky-100/30 hover:bg-primary/10'}`}
              style={{ left: f.ox + r.x0 * f.scale, top: f.oy - r.z1 * f.scale, width: (r.x1 - r.x0) * f.scale, height: (r.z1 - r.z0) * f.scale }}
              onClick={() => onSelect({ col: p.col, row: p.row })}
            />
          );
        })}
      </div>
      <figcaption className="text-center text-2xs text-zinc-500">{label}</figcaption>
    </figure>
  );
}

// View from the interior (−Y), turned 30° and raised 25°: x' = x cosθ − y sinθ, depth' = x sinθ + y cosθ.
const THETA = -Math.PI / 6, PHI = (25 * Math.PI) / 180;
const SHADE = { top: 1, front: 0.86, side: 0.7 };

function view(x: number, y: number, z: number): { x: number; y: number; depth: number } {
  const xr = x * Math.cos(THETA) - y * Math.sin(THETA);
  const dr = x * Math.sin(THETA) + y * Math.cos(THETA);
  return { x: xr, y: z * Math.cos(PHI) + dr * Math.sin(PHI), depth: dr * Math.cos(PHI) - z * Math.sin(PHI) };
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(Math.min(255, v * k)).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

function roleColor(spec: JoinerySpec, box: JoineryBox): string {
  if (box.role === 'glass') return spec.colors.glass;
  if (box.role === 'leaf') return spec.colors.leaf;
  if (box.role === 'handle') return '#8c8c94';
  if (box.role === 'board') return '#ebebe6';
  return spec.colors.frame;
}

/** Isometric view from the interior side, boxes painted back to front. */
export function JoineryIso({ spec, label, width, height }: { spec: JoinerySpec; label: string; width: number; height: number }) {
  const faces = useMemo(() => {
    const out: { pts: { x: number; y: number }[]; fill: string; alpha: number; depth: number }[] = [];
    for (const b of joineryBoxes(spec)) {
      const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
      const color = roleColor(spec, b);
      const alpha = b.role === 'glass' ? 0.45 : 1;
      const quad = (pts: [number, number, number][], k: number) => {
        const v = pts.map(([x, y, z]) => view(x, y, z));
        out.push({ pts: v, fill: shade(color, k), alpha, depth: v.reduce((s, p) => s + p.depth, 0) / v.length });
      };
      quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], SHADE.top);
      quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], SHADE.side);
      quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], SHADE.front);
      quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], SHADE.front);
      quad([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], SHADE.side);
      quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], SHADE.side);
    }
    // Far faces first.
    return out.sort((a, b) => b.depth - a.depth);
  }, [spec]);
  const f = useMemo(() => {
    const min = { x: Infinity, y: Infinity }, max = { x: -Infinity, y: -Infinity };
    for (const q of faces) for (const p of q.pts) {
      min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y);
    }
    return fit({ min, max }, width, height);
  }, [faces, width, height]);
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-700">
      <svg width={width} height={height} aria-hidden="true">
        {faces.map((q, i) => (
          <path key={i} d={q.pts.map((p, j) => `${j ? 'L' : 'M'}${(f.ox + p.x * f.scale).toFixed(1)},${(f.oy - p.y * f.scale).toFixed(1)}`).join('') + 'Z'}
            fill={q.fill} fillOpacity={q.alpha} stroke="#52525b" strokeWidth={0.3} />
        ))}
      </svg>
      <figcaption className="text-center text-2xs text-zinc-500">{label}</figcaption>
    </figure>
  );
}

export { elevationSymbol, planSymbol, sectionSymbol };
