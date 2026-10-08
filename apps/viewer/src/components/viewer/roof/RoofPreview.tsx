/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Live drawings of a roof system being configured: the plan — wall-plate
 * outline with numbered edges (click one to pick it), ridges, hips and
 * valleys, eaves and downslope arrows with their pitch — and an isometric
 * view of the covering planes over the structure's members.
 */

import { useMemo } from 'react';
import type { RoofGeometry, RoofMember } from '@ifc-lite/create';

type P = { x: number; y: number };

interface Fit { scale: number; ox: number; oy: number }

function fit(pts: readonly P[], w: number, h: number, margin = 16): Fit {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((w - 2 * margin) / Math.max(maxX - minX, 1e-6), (h - 2 * margin) / Math.max(maxY - minY, 1e-6));
  return { scale, ox: (w - (maxX - minX) * scale) / 2 - minX * scale, oy: (h + (maxY - minY) * scale) / 2 + minY * scale };
}

const STROKE: Record<RoofGeometry['lines'][number]['kind'], { w: number; dash?: string; color: string }> = {
  ridge: { w: 1.6, color: '#b91c1c' }, hip: { w: 1.1, color: '#1d4ed8' }, valley: { w: 1.1, dash: '4 2', color: '#047857' },
  eave: { w: 0.9, color: '#3f3f46' }, verge: { w: 0.9, color: '#3f3f46' },
};

export function RoofPlanPreview({ g, edge, onEdge, width, height, label }: {
  g: RoofGeometry; edge: number | null; onEdge: (edge: number) => void; width: number; height: number; label: string;
}) {
  const all = useMemo(() => [...g.outline.map(([x, y]) => ({ x, y })), ...g.planes.flatMap((p) => p.pts.map(([x, y]) => ({ x, y })))], [g]);
  const f = fit(all, width, height);
  const S = (x: number, y: number) => ({ x: f.ox + x * f.scale, y: f.oy - y * f.scale });
  const n = g.outline.length;
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-1 text-zinc-900 dark:border-zinc-700">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true" className="absolute inset-0">
          {g.planes.map((p) => (
            <path key={p.edge} d={p.pts.map((q, i) => `${i ? 'L' : 'M'}${S(q[0], q[1]).x},${S(q[0], q[1]).y}`).join('') + 'Z'}
              fill={p.edge === edge ? 'rgba(37,99,235,0.18)' : 'rgba(161,98,7,0.07)'} stroke="none" />
          ))}
          <path d={g.outline.map(([x, y], i) => `${i ? 'L' : 'M'}${S(x, y).x},${S(x, y).y}`).join('') + 'Z'} fill="none" stroke="#71717a" strokeWidth={0.8} strokeDasharray="5 3" />
          {g.lines.map((l, i) => {
            const st = STROKE[l.kind], a = S(l.a[0], l.a[1]), b = S(l.b[0], l.b[1]);
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={st.color} strokeWidth={st.w} strokeDasharray={st.dash} />;
          })}
          {g.planes.map((p) => {
            const c = p.pts.reduce((s, q) => [s[0] + q[0] / p.pts.length, s[1] + q[1] / p.pts.length], [0, 0]);
            const a = g.outline[p.edge], b = g.outline[(p.edge + 1) % n];
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const down = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
            const k = 18 / f.scale;
            const from = S(c[0] - down[0] * k, c[1] - down[1] * k), to = S(c[0] + down[0] * k, c[1] + down[1] * k);
            return (
              <g key={`a${p.edge}`} stroke="#18181b" strokeWidth={0.9} fill="none">
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                <circle cx={to.x} cy={to.y} r={2} fill="#18181b" />
                <text x={from.x} y={from.y - 3} fontSize={9} fill="#18181b" stroke="none" textAnchor="middle">{p.pitch}°</text>
              </g>
            );
          })}
        </svg>
        {g.outline.map(([x, y], i) => {
          const [x2, y2] = g.outline[(i + 1) % n];
          const m = S((x + x2) / 2, (y + y2) / 2);
          return (
            <button key={i} type="button" aria-label={`${label} · ${i + 1}`} aria-pressed={edge === i}
              className={`absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-2xs font-semibold ${edge === i ? 'border-primary bg-primary text-white' : 'border-zinc-400 bg-white hover:border-primary'} ${g.rules[i].kind === 'gable' ? 'ring-2 ring-amber-400' : ''}`}
              style={{ left: m.x, top: m.y }} onClick={() => onEdge(i)}>
              {i + 1}
            </button>
          );
        })}
      </div>
      <figcaption className="text-center text-2xs text-zinc-500">{label}</figcaption>
    </figure>
  );
}

const THETA = -Math.PI / 5, PHI = (28 * Math.PI) / 180;
function view(x: number, y: number, z: number) {
  const xr = x * Math.cos(THETA) - y * Math.sin(THETA);
  const dr = x * Math.sin(THETA) + y * Math.cos(THETA);
  return { x: xr, y: z * Math.cos(PHI) + dr * Math.sin(PHI), depth: dr * Math.cos(PHI) - z * Math.sin(PHI) };
}

export function RoofIsoPreview({ g, members, color, timber, width, height, label }: {
  g: RoofGeometry; members: readonly RoofMember[]; color: string; timber: string; width: number; height: number; label: string;
}) {
  const items = useMemo(() => {
    const out: { d: P[]; kind: 'plane' | 'member'; depth: number; w?: number }[] = [];
    for (const p of g.planes) {
      const v = p.pts.map(([x, y, z]) => view(x, y, z));
      out.push({ d: v, kind: 'plane', depth: v.reduce((s, q) => s + q.depth, 0) / v.length });
    }
    for (const m of members) {
      const a = view(...m.start), b = view(...m.end);
      out.push({ d: [a, b], kind: 'member', depth: (a.depth + b.depth) / 2 + 0.05, w: m.width });
    }
    return out.sort((a, b) => b.depth - a.depth);
  }, [g, members]);
  const f = fit(items.flatMap((i) => i.d), width, height);
  const S = (q: P) => `${(f.ox + q.x * f.scale).toFixed(1)},${(f.oy - q.y * f.scale).toFixed(1)}`;
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-700">
      <svg width={width} height={height} aria-hidden="true">
        {items.map((it, i) => it.kind === 'plane'
          ? <path key={i} d={`M${it.d.map(S).join('L')}Z`} fill={color} fillOpacity={0.55} stroke="#3f3f46" strokeWidth={0.6} />
          : <path key={i} d={`M${S(it.d[0])}L${S(it.d[1])}`} stroke={timber} strokeWidth={Math.max(1, (it.w ?? 0.08) * f.scale * 0.8)} strokeLinecap="round" />)}
      </svg>
      <figcaption className="text-center text-2xs text-zinc-500">{label}</figcaption>
    </figure>
  );
}
