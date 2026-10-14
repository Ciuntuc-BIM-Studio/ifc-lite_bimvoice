/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The horizontal alignment laid out entity by entity (Civil 3D's fixed,
 * floating and free lines and curves, `@ifc-lite/create`'s
 * `alignment-layout`): each entity's type and what places it. Switching a
 * PI chain to entities keeps its geometry (fixed tangents and free curves);
 * changing an entity's type starts it from where it runs now.
 */

import { buildAlignment, layoutFromPis, type AlignmentSegment, type CorridorSpec, type LayoutEntity } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { Plus, Trash2 } from 'lucide-react';
import { Cell } from './CorridorFields';
import { INPUT } from '../joinery/JoineryFields';

type V2 = [number, number];
type TypeId = 'fixedLine' | 'floatingLine' | 'freeLine' | 'fixedCurve' | 'floatingCurve' | 'freeCurve';

const TYPE_KEYS: Record<TypeId, TranslationKey> = {
  fixedLine: 'civil.layout.type.fixedLine', floatingLine: 'civil.layout.type.floatingLine', freeLine: 'civil.layout.type.freeLine',
  fixedCurve: 'civil.layout.type.fixedCurve', floatingCurve: 'civil.layout.type.floatingCurve', freeCurve: 'civil.layout.type.freeCurve',
};

const typeOf = (e: LayoutEntity): TypeId => `${e.constraint}${e.kind === 'line' ? 'Line' : 'Curve'}` as TypeId;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (p: V2): V2 => [r2(p[0]), r2(p[1])];

/** Entity `i` as `type`, started from the pieces it runs as now (or sensible sizes). */
function retyped(type: TypeId, runs: readonly AlignmentSegment[], end: (s: AlignmentSegment) => V2): LayoutEntity {
  const first = runs[0], last = runs[runs.length - 1];
  const start: V2 = first ? first.start : [0, 0];
  const stop: V2 = last ? end(last) : [start[0] + 100, start[1]];
  const arc = runs.find((s) => s.kind === 'arc');
  const radius = r2(arc?.radius ?? 100);
  const turn = arc?.turn ?? 1;
  switch (type) {
    case 'fixedLine': return { kind: 'line', constraint: 'fixed', a: pt(start), b: pt(stop) };
    case 'floatingLine': return { kind: 'line', constraint: 'floating', through: pt(stop) };
    case 'freeLine': return { kind: 'line', constraint: 'free' };
    case 'fixedCurve': {
      const d = arc?.direction ?? 0;
      return { kind: 'curve', constraint: 'fixed', center: pt([start[0] - Math.sin(d) * radius * turn, start[1] + Math.cos(d) * radius * turn]), radius, turn };
    }
    case 'floatingCurve': return { kind: 'curve', constraint: 'floating', radius, length: r2(runs.reduce((s, x) => s + x.length, 0) || 50), turn };
    case 'freeCurve': return { kind: 'curve', constraint: 'free', radius };
  }
}

function XY({ label, value, onCommit }: { label: string; value: V2; onCommit: (p: V2) => void }) {
  return (
    <span className="grid grid-cols-2 gap-1">
      <Cell label={`${label} X`} value={value[0]} onCommit={(x) => onCommit([x, value[1]])} />
      <Cell label={`${label} Y`} value={value[1]} onCommit={(y) => onCommit([value[0], y])} />
    </span>
  );
}

export function AlignmentLayoutFields({ spec, onChange }: { spec: CorridorSpec; onChange: (spec: CorridorSpec) => void }) {
  const { t } = useTranslation();
  const layout = spec.alignment.layout ?? [];
  const set = (next: LayoutEntity[] | undefined) => onChange({ ...spec, alignment: { ...spec.alignment, layout: next } });
  let built: ReturnType<typeof buildAlignment> | null = null;
  try { built = buildAlignment(spec.alignment); } catch { /* reported by the preview */ }
  const runsOf = (i: number) => built?.segments.filter((s) => s.pi === i) ?? [];
  const end = (s: AlignmentSegment): V2 => { const p = built!.pointAt(s.station + s.length); return [p.x, p.y]; };
  const patch = (i: number, e: LayoutEntity) => set(layout.map((x, k) => (k === i ? e : x)));
  const row = (label: string, child: React.ReactNode) => (
    <label className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
      <span className="truncate text-zinc-600 dark:text-zinc-400">{label}</span>{child}
    </label>
  );

  return (
    <div className="space-y-2">
      {row(t('civil.layout.mode'), (
        <select aria-label={t('civil.layout.mode')} className={INPUT} value={layout.length ? 'entities' : 'pis'}
          onChange={(e) => set(e.target.value === 'entities' ? layoutFromPis(spec.alignment.pis) : undefined)}>
          <option value="pis">{t('civil.layout.modePis')}</option>
          <option value="entities">{t('civil.layout.modeEntities')}</option>
        </select>
      ))}
      {layout.length ? <p className="text-zinc-500">{t('civil.layout.hint')}</p> : null}
      {layout.map((e, i) => (
        <div key={i} className="space-y-1 rounded-sm border border-zinc-200 p-1.5 dark:border-zinc-700">
          <div className="flex items-center gap-1">
            <span className="w-14 shrink-0 font-medium tabular-nums">{t('civil.layout.entity', { n: i + 1 })}</span>
            <select aria-label={`${t('civil.layout.type')} ${i + 1}`} className={INPUT} value={typeOf(e)} onChange={(ev) => patch(i, retyped(ev.target.value as TypeId, runsOf(i), end))}>
              {(Object.keys(TYPE_KEYS) as TypeId[]).map((k) => <option key={k} value={k}>{t(TYPE_KEYS[k])}</option>)}
            </select>
            <IconButton label={t('civil.row.insert')} className="size-6 shrink-0" onClick={() => set([...layout.slice(0, i + 1), retyped('freeCurve', runsOf(i), end), ...layout.slice(i + 1)])}><Plus className="size-3" /></IconButton>
            <IconButton label={t('civil.row.remove')} className="size-6 shrink-0" disabled={layout.length <= 1} onClick={() => set(layout.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton>
          </div>
          {e.kind === 'line' && e.constraint === 'fixed' ? (
            <>
              {row(t('civil.layout.a'), <XY label={`${t('civil.layout.a')} ${i + 1}`} value={e.a} onCommit={(a) => patch(i, { ...e, a })} />)}
              {row(t('civil.layout.b'), <XY label={`${t('civil.layout.b')} ${i + 1}`} value={e.b} onCommit={(b) => patch(i, { ...e, b })} />)}
            </>
          ) : null}
          {e.kind === 'line' && e.constraint === 'floating'
            ? row(t('civil.layout.through'), <XY label={`${t('civil.layout.through')} ${i + 1}`} value={e.through} onCommit={(through) => patch(i, { ...e, through })} />) : null}
          {e.constraint === 'free' && e.kind === 'line' ? <p className="text-zinc-500">{t('civil.layout.free')}</p> : null}
          {e.kind === 'curve' ? row(t('civil.layout.radius'), <Cell label={`${t('civil.layout.radius')} ${i + 1}`} value={e.radius} min={0} onCommit={(radius) => patch(i, { ...e, radius })} />) : null}
          {e.kind === 'curve' && e.constraint === 'fixed'
            ? row(t('civil.layout.center'), <XY label={`${t('civil.layout.center')} ${i + 1}`} value={e.center} onCommit={(center) => patch(i, { ...e, center })} />) : null}
          {e.kind === 'curve' && e.constraint === 'floating'
            ? row(t('civil.layout.length'), <Cell label={`${t('civil.layout.length')} ${i + 1}`} value={e.length} min={0} onCommit={(length) => patch(i, { ...e, length })} />) : null}
          {e.kind === 'curve' && e.constraint !== 'free' ? row(t('civil.layout.turn'), (
            <select aria-label={`${t('civil.layout.turn')} ${i + 1}`} className={INPUT} value={e.turn} onChange={(ev) => patch(i, { ...e, turn: Number(ev.target.value) as 1 | -1 })}>
              <option value={1}>{t('civil.layout.turnLeft')}</option>
              <option value={-1}>{t('civil.layout.turnRight')}</option>
            </select>
          )) : null}
          {e.kind === 'curve' && e.constraint === 'free' ? row(t('civil.layout.spirals'), (
            <span className="grid grid-cols-2 gap-1">
              <Cell label={`${t('civil.col.spiralIn')} ${i + 1}`} value={e.spiralIn ?? 0} min={0} onCommit={(v) => patch(i, { ...e, spiralIn: v || undefined })} />
              <Cell label={`${t('civil.col.spiralOut')} ${i + 1}`} value={e.spiralOut ?? 0} min={0} onCommit={(v) => patch(i, { ...e, spiralOut: v || undefined })} />
            </span>
          )) : null}
        </div>
      ))}
    </div>
  );
}
