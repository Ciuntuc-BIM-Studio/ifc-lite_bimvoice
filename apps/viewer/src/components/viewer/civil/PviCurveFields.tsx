/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The selected PVI's vertical curve, the Civil 3D way: no curve (a grade
 * break), a symmetric parabola by its length L or its K-value, an
 * asymmetric parabola by its two lengths either side of the PVI, or a
 * circular curve by its radius — with what it comes to (A, K, L, BVC, EVC).
 */

import { formatStation, kValue, segmentGrades, type ProfilePVI, type VerticalCurveInfo } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Cell } from './CorridorFields';
import { INPUT } from '../joinery/JoineryFields';

type Kind = 'none' | 'parabolic' | 'asymmetric' | 'circular';

const KIND_KEYS: Record<Kind, TranslationKey> = {
  none: 'civil.pvi.kind.none', parabolic: 'civil.pvi.kind.parabolic', asymmetric: 'civil.pvi.kind.asymmetric', circular: 'civil.pvi.kind.circular',
};

const fmt = (v: number, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d);

/** A PVI's curve kind, `none` for a bare grade break. */
export function curveKindOf(p: ProfilePVI): Kind {
  const kind = p.curve ?? 'parabolic';
  if (kind === 'parabolic' && !(p.k && p.k > 0) && !(p.length && p.length > 0)) return 'none';
  if (kind === 'asymmetric' && !((p.lengthIn ?? 0) > 0 && (p.lengthOut ?? 0) > 0)) return 'none';
  if (kind === 'circular' && !((p.radius ?? 0) > 0)) return 'none';
  return kind;
}

/** The PVI with its curve switched to `kind`, sized from what it had (or 80 % of the room it has). */
export function withCurveKind(pvis: readonly ProfilePVI[], i: number, kind: Kind): ProfilePVI {
  const { station, elevation } = pvis[i];
  const room = Math.min(station - pvis[i - 1].station, pvis[i + 1].station - station);
  const grades = segmentGrades(pvis).map((g) => g / 100);
  const delta = Math.abs(grades[i] - grades[i - 1]);
  const was = pvis[i].length ?? (pvis[i].lengthIn !== undefined ? (pvis[i].lengthIn! + (pvis[i].lengthOut ?? 0)) : Math.round(room * 0.8));
  const L = Math.min(was || Math.round(room * 0.8), Math.round(room * 1.6));
  switch (kind) {
    case 'none': return { station, elevation };
    case 'parabolic': return { station, elevation, length: L };
    case 'asymmetric': return { station, elevation, curve: 'asymmetric', lengthIn: Math.round(L / 2), lengthOut: Math.round(L / 2) };
    // R ≈ L / A: about the same curve as the parabola it replaces.
    case 'circular': return { station, elevation, curve: 'circular', radius: Math.round(delta > 1e-9 ? L / delta : 1000) };
  }
}

export function PviCurveFields({ pvis, index, built, onChange }: {
  pvis: readonly ProfilePVI[]; index: number | null; built: VerticalCurveInfo[];
  onChange: (pvi: ProfilePVI) => void;
}) {
  const { t } = useTranslation();
  if (index === null || !pvis[index]) return <p className="text-zinc-500">{t('civil.pvi.pick')}</p>;
  const p = pvis[index];
  const title = t('civil.pvi.title', { n: index, station: formatStation(p.station) });
  if (index === 0 || index === pvis.length - 1) {
    return <div className="space-y-1 rounded-sm border border-zinc-200 p-2 dark:border-zinc-700"><p className="font-semibold">{title}</p><p className="text-zinc-500">{t('civil.pvi.endHint')}</p></div>;
  }
  const kind = curveKindOf(p);
  const info = built.find((c) => c.pvi === index);
  const grades = segmentGrades(pvis);
  const a = Math.abs(grades[index] - grades[index - 1]);
  const byK = kind === 'parabolic' && (p.k ?? 0) > 0;
  const row = (label: string, child: React.ReactNode) => (
    <label className="grid grid-cols-[1fr_7rem] items-center gap-2">
      <span className="truncate text-zinc-600 dark:text-zinc-400">{label}</span>{child}
    </label>
  );
  return (
    <div className="space-y-1 rounded-sm border border-zinc-200 p-2 dark:border-zinc-700">
      <p className="font-semibold">{title}</p>
      {row(t('civil.pvi.kind'), (
        <select aria-label={t('civil.pvi.kind')} className={INPUT} value={kind} onChange={(e) => onChange(withCurveKind(pvis, index, e.target.value as Kind))}>
          {(Object.keys(KIND_KEYS) as Kind[]).map((k) => <option key={k} value={k}>{t(KIND_KEYS[k])}</option>)}
        </select>
      ))}
      {kind === 'parabolic' ? (
        <>
          {row(t('civil.pvi.by'), (
            <select aria-label={t('civil.pvi.by')} className={INPUT} value={byK ? 'k' : 'l'}
              onChange={(e) => {
                const L = info ? info.evc - info.bvc : p.length ?? 0;
                onChange(e.target.value === 'k'
                  ? { station: p.station, elevation: p.elevation, k: Math.round((kValue(L, 0, a / 100) ?? 10) * 10) / 10 }
                  : { station: p.station, elevation: p.elevation, length: Math.round(L * 100) / 100 });
              }}>
              <option value="l">{t('civil.pvi.byLength')}</option>
              <option value="k">{t('civil.pvi.byK')}</option>
            </select>
          ))}
          {byK
            ? row(t('civil.pvi.k'), <Cell label={t('civil.pvi.k')} value={p.k} min={0} onCommit={(k) => onChange({ station: p.station, elevation: p.elevation, ...(k > 0 ? { k } : {}) })} />)
            : row(t('civil.pvi.length'), <Cell label={t('civil.pvi.length')} value={p.length} min={0} onCommit={(length) => onChange({ station: p.station, elevation: p.elevation, ...(length > 0 ? { length } : {}) })} />)}
        </>
      ) : null}
      {kind === 'asymmetric' ? (
        <>
          {row(t('civil.pvi.lengthIn'), <Cell label={t('civil.pvi.lengthIn')} value={p.lengthIn} min={0} onCommit={(lengthIn) => onChange({ ...p, lengthIn })} />)}
          {row(t('civil.pvi.lengthOut'), <Cell label={t('civil.pvi.lengthOut')} value={p.lengthOut} min={0} onCommit={(lengthOut) => onChange({ ...p, lengthOut })} />)}
        </>
      ) : null}
      {kind === 'circular' ? row(t('civil.pvi.radius'), <Cell label={t('civil.pvi.radius')} value={p.radius} min={0} onCommit={(radius) => onChange({ ...p, radius })} />) : null}
      {info ? (
        <p className="text-zinc-500 tabular-nums">
          {t('civil.pvi.readout', { a: fmt(a), k: info.k === null ? '—' : fmt(info.k, 1), l: fmt(info.evc - info.bvc, 1), bvc: formatStation(info.bvc), evc: formatStation(info.evc) })}
        </p>
      ) : null}
    </div>
  );
}

/** The table's short note of a PVI's curve. */
export function curveSummary(p: ProfilePVI, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  switch (curveKindOf(p)) {
    case 'none': return '';
    case 'asymmetric': return t('civil.pvi.summary.asymmetric', { a: fmt(p.lengthIn ?? 0, 1), b: fmt(p.lengthOut ?? 0, 1) });
    case 'circular': return t('civil.pvi.summary.radius', { r: fmt(p.radius ?? 0, 0) });
    default: return (p.k ?? 0) > 0 ? t('civil.pvi.summary.k', { k: fmt(p.k!, 1) }) : t('civil.pvi.summary.length', { l: fmt(p.length ?? 0, 1) });
  }
}
