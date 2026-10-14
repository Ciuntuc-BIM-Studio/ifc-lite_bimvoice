/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The vertical profile, edited where it is drawn (Civil 3D's Profile Layout
 * Tools): ground in green, the tangents through the PVIs, the design grade
 * line in red with each vertical curve marked BVC … EVC and labelled (L and
 * K, the two lengths of an asymmetric curve, or R), each tangent's grade.
 *
 *  - drag a PVI to move it (an end PVI only up or down; never past its
 *    neighbours), or move it from the keyboard;
 *  - double-click a grade to insert a PVI on it (the line does not change);
 *  - click to pick a PVI (its curve is set in the PVI panel) or a station
 *    (the cross-section shown); Delete removes the picked inner PVI.
 *
 * Heights are exaggerated to fill the frame; the frame holds still while a
 * PVI is dragged.
 */

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { buildProfile, formatStation, Terrain, type CorridorModel, type ProfilePVI, type Tin } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { capturePointer } from '@/lib/pointer-capture';
import { curveSummary } from './PviCurveFields';

interface Frame { s0: number; s1: number; z0: number; z1: number }

const PAD = { l: 34, r: 10, t: 22, b: 16 };
const round = (v: number, step: number) => Math.round(v / step) * step;

export function ProfileEditor({ model, terrain, pvis, onChange, selected, onSelect, station, onStation, width, height }: {
  model: CorridorModel; terrain: Tin | null; pvis: readonly ProfilePVI[];
  onChange: (pvis: ProfilePVI[]) => void;
  selected: number | null; onSelect: (i: number | null) => void;
  station: number; onStation: (s: number) => void;
  width: number; height: number;
}) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ i: number; frame: Frame } | null>(null);
  const a = model.alignment;
  const ground = useMemo(() => {
    if (!terrain) return [];
    const tin = new Terrain(terrain);
    const out: { s: number; z: number }[] = [];
    const step = Math.max((a.endStation - a.startStation) / 200, 0.5);
    for (let s = a.startStation; s <= a.endStation + 1e-9; s += step) {
      const p = a.pointAt(Math.min(s, a.endStation));
      const z = tin.elevationAt(p.x, p.y);
      if (z !== null) out.push({ s, z });
    }
    return out;
  }, [a, terrain]);
  const profile = model.profile;
  const grade = useMemo(() => {
    const step = Math.max((a.endStation - a.startStation) / 400, 0.25);
    const out: { s: number; z: number }[] = [];
    for (let s = a.startStation; s < a.endStation; s += step) out.push({ s, z: profile.elevationAt(s) });
    out.push({ s: a.endStation, z: profile.elevationAt(a.endStation) });
    return out;
  }, [a, profile]);

  const live: Frame = useMemo(() => {
    const zs = [...grade.map((p) => p.z), ...ground.map((p) => p.z), ...pvis.map((p) => p.elevation)];
    const lo = Math.min(...zs), hi = Math.max(...zs), m = Math.max((hi - lo) * 0.12, 0.5);
    return { s0: a.startStation, s1: a.endStation, z0: lo - m, z1: hi + m };
  }, [a, grade, ground, pvis]);
  const f = drag?.frame ?? live;
  const X = (s: number) => PAD.l + ((s - f.s0) / Math.max(f.s1 - f.s0, 1e-6)) * (width - PAD.l - PAD.r);
  const Y = (z: number) => PAD.t + (1 - (z - f.z0) / Math.max(f.z1 - f.z0, 1e-6)) * (height - PAD.t - PAD.b);
  const toModel = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return {
      s: f.s0 + ((px - PAD.l) / (width - PAD.l - PAD.r)) * (f.s1 - f.s0),
      z: f.z0 + (1 - (py - PAD.t) / (height - PAD.t - PAD.b)) * (f.z1 - f.z0),
    };
  };
  const line = (pts: { s: number; z: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`).join('');

  /** PVI `i` moved to (s, z): kept between its neighbours, the ends on their stations; null when the profile would not build. */
  const moved = (i: number, s: number, z: number): ProfilePVI[] | null => {
    const end = i === 0 || i === pvis.length - 1;
    const lo = i > 0 ? pvis[i - 1].station + 1 : -Infinity, hi = i < pvis.length - 1 ? pvis[i + 1].station - 1 : Infinity;
    const station = end ? pvis[i].station : Math.min(Math.max(round(s, 0.1), lo), hi);
    const next = pvis.map((p, k) => (k === i ? { ...p, station: Math.round(station * 100) / 100, elevation: Math.round(round(z, 0.01) * 1000) / 1000 } : p));
    try { buildProfile({ pvis: next }); return next; } catch { return null; }
  };

  const onHandleDown = (e: ReactPointerEvent, i: number) => {
    e.stopPropagation();
    onSelect(i);
    capturePointer(e.currentTarget as Element, e.pointerId);
    setDrag({ i, frame: live });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const { s, z } = toModel(e);
    const next = moved(drag.i, s, z);
    if (next) onChange(next);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const dz = e.shiftKey ? 0.1 : 0.01, ds = e.shiftKey ? 10 : 1;
    const p = pvis[i];
    const step: Record<string, [number, number]> = { ArrowUp: [0, dz], ArrowDown: [0, -dz], ArrowLeft: [-ds, 0], ArrowRight: [ds, 0] };
    if (step[e.key]) {
      e.preventDefault();
      const next = moved(i, p.station + step[e.key][0], p.elevation + step[e.key][1]);
      if (next) onChange(next);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && i > 0 && i < pvis.length - 1) {
      e.preventDefault();
      onChange(pvis.filter((_, k) => k !== i));
      onSelect(null);
    }
  };
  /** A new PVI on the tangent under station `s` (so the grade line stays as it is). */
  const insertAt = (s: number) => {
    const at = pvis.findIndex((p) => p.station > s);
    if (at <= 0 || s - pvis[at - 1].station < 2 || pvis[at].station - s < 2) return;
    const [p0, p1] = [pvis[at - 1], pvis[at]];
    const z = p0.elevation + ((p1.elevation - p0.elevation) * (s - p0.station)) / (p1.station - p0.station);
    const next = [...pvis.slice(0, at), { station: Math.round(s * 100) / 100, elevation: Math.round(z * 1000) / 1000 }, ...pvis.slice(at)];
    onChange(next);
    onSelect(at);
  };

  const curves = profile.curves();
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-1 text-zinc-900 dark:border-zinc-700">
      <div className="relative" style={{ width, height }}>
        <svg
          ref={svg} width={width} height={height} aria-label={t('civil.profileEdit.label')} className="touch-none select-none"
          onPointerMove={onMove} onPointerCancel={() => setDrag(null)}
          onPointerUp={(e) => {
            // A click that dragged nothing picks a station: the cross-section shown there.
            if (!drag) { onStation(Math.min(Math.max(toModel(e).s, a.startStation), a.endStation)); onSelect(null); }
            setDrag(null);
          }}
          onDoubleClick={(e) => insertAt(toModel(e).s)}
        >
          <text x={4} y={PAD.t - 6} fontSize={9} fill="#71717a">{f.z1.toFixed(2)}</text>
          <text x={4} y={height - PAD.b} fontSize={9} fill="#71717a">{f.z0.toFixed(2)}</text>
          <text x={PAD.l} y={height - 3} fontSize={9} fill="#71717a">{formatStation(a.startStation)}</text>
          <text x={width - PAD.r} y={height - 3} fontSize={9} fill="#71717a" textAnchor="end">{formatStation(a.endStation)}</text>
          {ground.length ? <path d={line(ground)} fill="none" stroke="#15803d" strokeWidth={1} /> : null}
          <path d={line(pvis.map((p) => ({ s: p.station, z: p.elevation })))} fill="none" stroke="#a1a1aa" strokeWidth={0.8} strokeDasharray="4 3" />
          <path d={line(grade)} fill="none" stroke="#b91c1c" strokeWidth={1.6} />
          {pvis.slice(1).map((p, i) => {
            const q = pvis[i];
            const g = ((p.elevation - q.elevation) / (p.station - q.station)) * 100;
            const mid = (p.station + q.station) / 2;
            if (X(p.station) - X(q.station) < 46) return null;
            return <text key={`g${i}`} x={X(mid)} y={Y((p.elevation + q.elevation) / 2) - 5} fontSize={9} fill="#3f3f46" textAnchor="middle">{`${g >= 0 ? '+' : ''}${g.toFixed(2)} %`}</text>;
          })}
          {curves.map((c) => (
            <g key={`c${c.pvi}`} stroke="#2563eb" strokeWidth={0.8}>
              <line x1={X(c.bvc)} y1={Y(profile.elevationAt(c.bvc)) - 6} x2={X(c.bvc)} y2={Y(profile.elevationAt(c.bvc)) + 6} />
              <line x1={X(c.evc)} y1={Y(profile.elevationAt(c.evc)) - 6} x2={X(c.evc)} y2={Y(profile.elevationAt(c.evc)) + 6} />
              <text x={X(c.station)} y={Y(pvis[c.pvi].elevation) - 9} fontSize={9} fill="#1d4ed8" stroke="none" textAnchor="middle">{curveSummary(pvis[c.pvi], t)}</text>
            </g>
          ))}
          <line x1={X(station)} y1={PAD.t} x2={X(station)} y2={height - PAD.b} stroke="#2563eb" strokeWidth={1} strokeDasharray="3 2" />
        </svg>
        {pvis.map((p, i) => (
          <button
            key={`h${i}`} type="button"
            className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border-2 border-blue-600 ${selected === i ? 'size-3.5 bg-blue-600' : 'size-3 bg-white'}`}
            style={{ left: X(p.station), top: Y(p.elevation) }}
            aria-label={t('civil.profileEdit.pvi', { n: i, station: formatStation(p.station), elevation: p.elevation.toFixed(2) })} aria-pressed={selected === i}
            onPointerDown={(e) => onHandleDown(e, i)} onPointerMove={onMove} onPointerUp={(e) => { e.stopPropagation(); setDrag(null); }}
            onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => onKey(e, i)} onFocus={() => onSelect(i)}
          />
        ))}
      </div>
      <figcaption className="px-1 text-2xs text-zinc-500">{t('civil.profileEdit.hint')}</figcaption>
    </figure>
  );
}
