/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The fields of a curtain wall's build — how its two grids divide it,
 * mullion and transom sections, the perimeter frame, the panels and the
 * colours — shared by the curtain wall configurator and the curtain wall
 * types of the element types catalogue. Lengths in millimetres.
 */

import type { CurtainGridRule, CurtainWallTypeSpec } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Field, Mm } from '../element-types/TypeFields';

const CELL = 'h-6 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 tabular-nums';
const MODES: readonly CurtainGridRule['mode'][] = ['max', 'count', 'spacing', 'offsets'];

function defaultRule(mode: CurtainGridRule['mode'], from: CurtainGridRule): CurtainGridRule {
  const spacing = 'spacing' in from ? from.spacing : 1.5;
  switch (mode) {
    case 'count': return { mode, count: from.mode === 'count' ? from.count : 3 };
    case 'max': return { mode, spacing };
    case 'spacing': return { mode, spacing, justify: 'center' };
    case 'offsets': return { mode, offsets: from.mode === 'offsets' ? from.offsets : [spacing] };
  }
}

function GridRuleFields({ label, rule, onChange }: { label: string; rule: CurtainGridRule; onChange: (rule: CurtainGridRule) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={label}>
        <select aria-label={label} className={CELL} value={rule.mode} onChange={(e) => onChange(defaultRule(e.target.value as CurtainGridRule['mode'], rule))}>
          {MODES.map((m) => <option key={m} value={m}>{t(`curtainCfg.grid.${m}` as TranslationKey)}</option>)}
        </select>
      </Field>
      {rule.mode === 'count' ? (
        <Field label={t('curtainCfg.grid.countLabel')}>
          <input aria-label={t('curtainCfg.grid.countLabel')} type="number" min={1} max={200} className={CELL} value={rule.count}
            onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n >= 1) onChange({ ...rule, count: n }); }} />
        </Field>
      ) : null}
      {rule.mode === 'max' || rule.mode === 'spacing' ? (
        <Field label={t(rule.mode === 'max' ? 'curtainCfg.grid.maxLabel' : 'curtainCfg.grid.spacingLabel')}>
          <Mm label={t('curtainCfg.grid.spacingLabel')} value={rule.spacing} onCommit={(spacing) => onChange({ ...rule, spacing })} />
        </Field>
      ) : null}
      {rule.mode === 'spacing' ? (
        <Field label={t('curtainCfg.grid.justify')}>
          <select aria-label={t('curtainCfg.grid.justify')} className={CELL} value={rule.justify} onChange={(e) => onChange({ ...rule, justify: e.target.value as typeof rule.justify })}>
            {(['start', 'center', 'end'] as const).map((j) => <option key={j} value={j}>{t(`curtainCfg.grid.justify.${j}` as TranslationKey)}</option>)}
          </select>
        </Field>
      ) : null}
      {rule.mode === 'offsets' ? (
        <Field label={t('curtainCfg.grid.offsetsLabel')}>
          <input aria-label={t('curtainCfg.grid.offsetsLabel')} className={CELL} defaultValue={rule.offsets.map((o) => Math.round(o * 1000)).join(' ')} key={rule.offsets.join()}
            onBlur={(e) => {
              const offsets = e.target.value.split(/[\s;,]+/).map((v) => Number(v) / 1000).filter((v) => Number.isFinite(v) && v > 0);
              if (offsets.length) onChange({ mode: 'offsets', offsets });
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </Field>
      ) : null}
    </>
  );
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input type="color" aria-label={label} className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function CurtainTypeFields({ spec, onChange }: { spec: CurtainWallTypeSpec; onChange: (spec: CurtainWallTypeSpec) => void }) {
  const { t } = useTranslation();
  const set = (patch: Partial<CurtainWallTypeSpec>) => onChange({ ...spec, ...patch });
  return (
    <div className="space-y-1">
      <p className="pt-1 font-semibold">{t('curtainCfg.section.grid')}</p>
      <GridRuleFields label={t('curtainCfg.grid.u')} rule={spec.u} onChange={(u) => set({ u })} />
      <GridRuleFields label={t('curtainCfg.grid.v')} rule={spec.v} onChange={(v) => set({ v })} />
      <p className="pt-2 font-semibold">{t('curtainCfg.section.members')}</p>
      <Field label={t('curtainCfg.mullionWidth')}><Mm label={t('curtainCfg.mullionWidth')} value={spec.mullion.width} onCommit={(width) => set({ mullion: { ...spec.mullion, width } })} /></Field>
      <Field label={t('curtainCfg.mullionDepth')}><Mm label={t('curtainCfg.mullionDepth')} value={spec.mullion.depth} onCommit={(depth) => set({ mullion: { ...spec.mullion, depth } })} /></Field>
      <Field label={t('curtainCfg.transomWidth')}><Mm label={t('curtainCfg.transomWidth')} value={spec.transom.width} onCommit={(width) => set({ transom: { ...spec.transom, width } })} /></Field>
      <Field label={t('curtainCfg.transomDepth')}><Mm label={t('curtainCfg.transomDepth')} value={spec.transom.depth} onCommit={(depth) => set({ transom: { ...spec.transom, depth } })} /></Field>
      <Field label={t('curtainCfg.edge')}>
        <input type="checkbox" aria-label={t('curtainCfg.edge')} checked={spec.edge} onChange={(e) => set({ edge: e.target.checked })} />
      </Field>
      <p className="pt-2 font-semibold">{t('curtainCfg.section.panels')}</p>
      <Field label={t('curtainCfg.panelKind')}>
        <select aria-label={t('curtainCfg.panelKind')} className={CELL} value={spec.panel.kind} onChange={(e) => set({ panel: { ...spec.panel, kind: e.target.value as 'glass' | 'opaque' } })}>
          <option value="glass">{t('curtainCfg.panel.glass')}</option>
          <option value="opaque">{t('curtainCfg.panel.opaque')}</option>
        </select>
      </Field>
      <Field label={t('curtainCfg.panelThickness')}><Mm label={t('curtainCfg.panelThickness')} value={spec.panel.thickness} onCommit={(thickness) => set({ panel: { ...spec.panel, thickness } })} /></Field>
      <Colour label={t('curtainCfg.frameColor')} value={spec.frameColor} onChange={(frameColor) => set({ frameColor })} />
      {spec.panel.kind === 'glass'
        ? <Colour label={t('curtainCfg.glassColor')} value={spec.glassColor} onChange={(glassColor) => set({ glassColor })} />
        : <Colour label={t('curtainCfg.opaqueColor')} value={spec.opaqueColor} onChange={(opaqueColor) => set({ opaqueColor })} />}
    </div>
  );
}
