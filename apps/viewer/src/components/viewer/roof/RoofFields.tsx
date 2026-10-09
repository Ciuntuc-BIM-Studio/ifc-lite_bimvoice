/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The roof configurator's two zones. Architecture: name, wall-plate height,
 * colours, the covering's layers, and a row per outline edge — eave or gable, pitch, overhang —
 * with one row to set every eave at once. Structure: the system, then
 * rafters (section and spacing), purlins, ridge beam, wall plates, hip and
 * valley rafters (each switchable) and the build-up above the rafters — or
 * trusses: spacing, chord and web sections, king post or fink pattern.
 */

import { useState, type ReactNode } from 'react';
import { END_CUTS, defaultTruss, type EndCut, type MemberSection, type RoofEdgeRule, type RoofStructureSpec, type RoofSystemSpec, type TrussSpec } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { INPUT, NumberField, Section } from '../joinery/JoineryFields';
import { CoveringLayers } from './RoofLayers';
import { CELL, Num } from './RoofNum';

interface Props {
  spec: RoofSystemSpec;
  onChange: (spec: RoofSystemSpec) => void;
  /** The edge highlighted in the preview. */
  edge: number | null;
  onEdge: (edge: number | null) => void;
}

export function ArchitectureFields({ spec, onChange, edge, onEdge }: Props) {
  const { t } = useTranslation();
  const n = spec.outline.length;
  const setRule = (i: number, patch: Partial<RoofEdgeRule>) => onChange({ ...spec, rules: spec.rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const firstEave = spec.rules.find((r) => r.kind === 'eave');
  const [all, setAll] = useState<{ pitch: number; overhang: number }>({ pitch: firstEave?.pitch ?? 30, overhang: firstEave?.overhang ?? 0.5 });
  return (
    <>
      <Section title={t('roof.zone.architecture')}>
        <label className="grid grid-cols-[1fr_9rem] items-center gap-2 text-xs">
          <span className="text-zinc-600 dark:text-zinc-400">{t('roof.field.name')}</span>
          <input className={INPUT} defaultValue={spec.name} key={spec.name} onBlur={(e) => e.target.value.trim() && onChange({ ...spec, name: e.target.value.trim() })} />
        </label>
        <NumberField label={t('roof.field.eaveHeight')} value={spec.eaveHeight} min={-1000} onChange={(v) => v !== undefined && onChange({ ...spec, eaveHeight: v })} />
        <div className="flex gap-4 pt-1 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="color" className="h-6 w-8 rounded-sm border border-zinc-300 dark:border-zinc-700" value={spec.covering.color} onChange={(e) => onChange({ ...spec, covering: { ...spec.covering, color: e.target.value } })} />
            {t('roof.field.coveringColor')}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="color" className="h-6 w-8 rounded-sm border border-zinc-300 dark:border-zinc-700" value={spec.timberColor} onChange={(e) => onChange({ ...spec, timberColor: e.target.value })} />
            {t('roof.field.timberColor')}
          </label>
        </div>
      </Section>
      <Section title={t('roof.field.covering')}>
        <CoveringLayers spec={spec} onChange={onChange} />
      </Section>
      <Section title={t('roof.edges')}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="w-8 font-medium">{t('roof.edge')}</th>
              <th className="font-medium">{t('roof.edge.length')}</th>
              <th className="font-medium">{t('roof.edge.kind')}</th>
              <th className="font-medium">{t('roof.edge.pitch')}</th>
              <th className="font-medium">{t('roof.edge.overhang')}</th>
            </tr>
          </thead>
          <tbody>
            {spec.rules.map((rule, i) => {
              const a = spec.outline[i], b = spec.outline[(i + 1) % n];
              return (
                <tr key={i} className={`border-t border-zinc-100 dark:border-zinc-800 ${edge === i ? 'bg-primary/10' : ''}`} onFocus={() => onEdge(i)} onMouseEnter={() => onEdge(i)}>
                  <td className="font-semibold tabular-nums">{i + 1}</td>
                  <td className="tabular-nums text-zinc-600">{Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(2)}</td>
                  <td>
                    <select aria-label={`${t('roof.edge')} ${i + 1}`} className={CELL} value={rule.kind} onChange={(e) => setRule(i, { kind: e.target.value as RoofEdgeRule['kind'], pitch: e.target.value === 'eave' && !rule.pitch ? all.pitch : rule.pitch })}>
                      <option value="eave">{t('roof.edge.eave')}</option>
                      <option value="gable">{t('roof.edge.gable')}</option>
                    </select>
                  </td>
                  <td><Num label={`${t('roof.edge.pitch')} ${i + 1}`} value={rule.pitch} disabled={rule.kind === 'gable'} onCommit={(v) => setRule(i, { pitch: v })} /></td>
                  <td><Num label={`${t('roof.edge.overhang')} ${i + 1}`} value={rule.overhang} scale={1000} onCommit={(v) => setRule(i, { overhang: v })} /></td>
                </tr>
              );
            })}
            <tr className="border-t border-zinc-300 dark:border-zinc-700">
              <td colSpan={3} className="text-zinc-500">{t('roof.edge.all')}</td>
              <td><Num label={`${t('roof.edge.all')} · ${t('roof.edge.pitch')}`} value={all.pitch} onCommit={(v) => setAll({ ...all, pitch: v })} /></td>
              <td><Num label={`${t('roof.edge.all')} · ${t('roof.edge.overhang')}`} value={all.overhang} scale={1000} onCommit={(v) => setAll({ ...all, overhang: v })} /></td>
            </tr>
          </tbody>
        </table>
        <button type="button" className="rounded-sm border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={() => onChange({ ...spec, rules: spec.rules.map((r) => (r.kind === 'eave' ? { ...r, pitch: all.pitch, overhang: all.overhang } : r)) })}>
          {t('roof.edge.applyAll')}
        </button>
      </Section>
    </>
  );
}

function SectionFields({ title, value, onChange, enabled, onEnabled }: {
  title: string; value: MemberSection; onChange: (v: MemberSection) => void; enabled?: boolean; onEnabled?: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      {onEnabled ? (
        <label className="flex items-center gap-1.5 text-xs font-medium">
          <input type="checkbox" checked={!!enabled} onChange={(e) => onEnabled(e.target.checked)} />{title}
        </label>
      ) : <p className="text-xs font-medium">{title}</p>}
      {enabled !== false ? (
        <div className="grid grid-cols-2 gap-2 pl-4">
          <NumberField label={t('roof.structure.width')} value={value.width} min={10} onChange={(v) => v && onChange({ ...value, width: v })} />
          <NumberField label={t('roof.structure.depth')} value={value.depth} min={10} onChange={(v) => v && onChange({ ...value, depth: v })} />
        </div>
      ) : null}
    </div>
  );
}

export function StructureFields({ spec, onChange }: Pick<Props, 'spec' | 'onChange'>) {
  const { t } = useTranslation();
  const st = spec.structure;
  const set = (patch: Partial<RoofStructureSpec>) => onChange({ ...spec, structure: { ...st, ...patch } });
  const optional = (key: 'ridge' | 'wallPlate' | 'hipRafter', label: TranslationKey, fallback: MemberSection) => (
    <SectionFields title={t(label)} value={st[key] ?? fallback} enabled={st[key] !== null} onEnabled={(on) => set({ [key]: on ? fallback : null })} onChange={(v) => set({ [key]: v })} />
  );
  return (
    <Section title={t('roof.zone.structure')}>
      <label className="grid grid-cols-[1fr_12rem] items-center gap-2 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">{t('roof.structure.system')}</span>
        <select className={INPUT} value={st.system} onChange={(e) => set({ system: e.target.value as RoofStructureSpec['system'] })}>
          <option value="rafters">{t('roof.structure.rafters')}</option>
          <option value="trusses">{t('roof.structure.trusses')}</option>
          <option value="none">{t('roof.structure.none')}</option>
        </select>
      </label>
      {st.system === 'rafters' ? (
        <>
          <SectionFields title={t('roof.structure.rafter')} value={st.rafter} onChange={(v) => set({ rafter: { ...st.rafter, ...v } })} />
          <div className="pl-4"><NumberField label={t('roof.structure.spacing')} value={st.rafter.spacing} min={100} onChange={(v) => v && set({ rafter: { ...st.rafter, spacing: v } })} /></div>
          <NumberField label={t('roof.structure.purlins')} value={st.purlins} plain onChange={(v) => v !== undefined && set({ purlins: Math.max(0, Math.min(3, Math.round(v))) })} />
          {st.purlins > 0 ? <SectionFields title={t('roof.structure.purlin')} value={st.purlin} onChange={(v) => set({ purlin: v })} /> : null}
          {optional('ridge', 'roof.structure.ridge', { width: 0.14, depth: 0.2 })}
          {optional('wallPlate', 'roof.structure.wallPlate', { width: 0.14, depth: 0.14 })}
          {optional('hipRafter', 'roof.structure.hip', { width: 0.1, depth: 0.2 })}
          <NumberField label={t('roof.structure.cover')} value={st.coverDepth} onChange={(v) => v !== undefined && set({ coverDepth: v })} />
          <RafterEnds value={st.rafterEnds} onChange={(rafterEnds) => set({ rafterEnds })} />
        </>
      ) : null}
      {st.system === 'trusses' ? <TrussFields truss={st.truss ?? defaultTruss()} onChange={(truss) => set({ truss })} optional={optional} cover={st.coverDepth} onCover={(v) => set({ coverDepth: v })} /> : null}
    </Section>
  );
}

function TrussFields({ truss, onChange, optional, cover, onCover }: {
  truss: TrussSpec; onChange: (t: TrussSpec) => void; cover: number; onCover: (v: number) => void;
  optional: (key: 'wallPlate' | 'hipRafter', label: TranslationKey, fallback: MemberSection) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <NumberField label={t('roof.structure.spacing')} value={truss.spacing} min={100} onChange={(v) => v && onChange({ ...truss, spacing: v })} />
      <label className="grid grid-cols-[1fr_12rem] items-center gap-2 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">{t('roof.truss.pattern')}</span>
        <select className={INPUT} value={truss.pattern} onChange={(e) => onChange({ ...truss, pattern: e.target.value as TrussSpec['pattern'] })}>
          <option value="fink">{t('roof.truss.fink')}</option>
          <option value="king">{t('roof.truss.king')}</option>
        </select>
      </label>
      <SectionFields title={t('roof.truss.chord')} value={truss.chord} onChange={(v) => onChange({ ...truss, chord: v })} />
      <SectionFields title={t('roof.truss.web')} value={truss.web} onChange={(v) => onChange({ ...truss, web: v })} />
      {optional('wallPlate', 'roof.structure.wallPlate', { width: 0.14, depth: 0.14 })}
      {optional('hipRafter', 'roof.structure.hip', { width: 0.1, depth: 0.2 })}
      <NumberField label={t('roof.structure.cover')} value={cover} onChange={(v) => v !== undefined && onCover(v)} />
    </>
  );
}

/** How rafters are cut at the eave and at the ridge (a part's own cut, set inside the block, wins). */
function RafterEnds({ value, onChange }: { value: RoofStructureSpec['rafterEnds']; onChange: (v: RoofStructureSpec['rafterEnds']) => void }) {
  const { t } = useTranslation();
  const ends = value ?? { eave: 'square' as const, ridge: 'square' as const };
  const row = (key: 'eave' | 'ridge', label: string) => (
    <label className="grid grid-cols-[1fr_12rem] items-center gap-2 text-xs">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <select className={INPUT} value={ends[key]} onChange={(e) => onChange({ ...ends, [key]: e.target.value as EndCut })}>
        {END_CUTS.map((c) => <option key={c} value={c}>{t(`roofBlock.cut.${c}`)}</option>)}
      </select>
    </label>
  );
  return (
    <>
      {row('eave', t('roof.structure.eaveCut'))}
      {row('ridge', t('roof.structure.ridgeCut'))}
    </>
  );
}
