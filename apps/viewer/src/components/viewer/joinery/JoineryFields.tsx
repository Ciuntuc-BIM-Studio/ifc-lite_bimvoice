/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The configurator's plain fields: identity, size, frame and sash profiles,
 * boards / threshold / colours and the common properties. Lengths are typed
 * in millimetres and stored in metres; a field commits on blur or Enter.
 */

import { useState, type ReactNode } from 'react';
import type { JoinerySpec } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';

export const INPUT = 'h-7 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1.5 text-xs tabular-nums';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

interface NumberFieldProps {
  label: string;
  /** Metres (shown in mm), or a plain number with `plain`. */
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  plain?: boolean;
  min?: number;
  optional?: boolean;
}

export function NumberField({ label, value, onChange, plain, min = 0, optional }: NumberFieldProps) {
  const { t } = useTranslation();
  const shown = value === undefined ? '' : plain ? String(value) : String(Math.round(value * 1000 * 10) / 10);
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const trimmed = text.trim();
    setText(null);
    if (!trimmed && optional) { onChange(undefined); return; }
    const n = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(n) || n < min) return;
    onChange(plain ? n : n / 1000);
  };
  return (
    <label className="grid grid-cols-[1fr_5.5rem] items-center gap-2 text-xs">
      <span className="truncate text-zinc-600 dark:text-zinc-400">{plain ? label : t('joinery.inMm', { label })}</span>
      <input
        className={INPUT} inputMode="decimal" value={text ?? shown}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setText(null); }}
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid grid-cols-[1fr_9rem] items-center gap-2 text-xs">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <input className={INPUT} defaultValue={value} key={value} onBlur={(e) => e.target.value !== value && onChange(e.target.value)} />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input type="color" className="h-6 w-8 cursor-pointer rounded-sm border border-zinc-300 dark:border-zinc-700" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
    </label>
  );
}

interface Props {
  spec: JoinerySpec;
  onChange: (spec: JoinerySpec) => void;
}

export function GeneralFields({ spec, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <Section title={t('joinery.section.general')}>
        <TextField label={t('joinery.field.name')} value={spec.name} onChange={(name) => onChange({ ...spec, name: name || spec.name })} />
        <TextField label={t('joinery.field.mark')} value={spec.mark} onChange={(mark) => onChange({ ...spec, mark })} />
      </Section>
      <Section title={t('joinery.section.size')}>
        <NumberField label={t('joinery.field.width')} value={spec.width} min={50} onChange={(v) => v && onChange({ ...spec, width: v })} />
        <NumberField label={t('joinery.field.height')} value={spec.height} min={50} onChange={(v) => v && onChange({ ...spec, height: v })} />
        {spec.kind === 'window' ? <NumberField label={t('joinery.field.sill')} value={spec.sillHeight} onChange={(v) => v !== undefined && onChange({ ...spec, sillHeight: v })} /> : null}
      </Section>
    </>
  );
}

export function ProfileFields({ spec, onChange }: Props) {
  const { t } = useTranslation();
  const frame = (patch: Partial<JoinerySpec['frame']>) => onChange({ ...spec, frame: { ...spec.frame, ...patch } });
  const sash = (patch: Partial<JoinerySpec['sash']>) => onChange({ ...spec, sash: { ...spec.sash, ...patch } });
  const num = (key: TranslationKey, value: number, set: (v: number) => void, min = 0) => (
    <NumberField label={t(key)} value={value} min={min} onChange={(v) => v !== undefined && set(v)} />
  );
  return (
    <Section title={t('joinery.section.frame')}>
      {num('joinery.field.frameDepth', spec.frame.depth, (v) => v > 0 && frame({ depth: v }), 1)}
      {num('joinery.field.frameWidth', spec.frame.width, (v) => v > 0 && frame({ width: v }), 1)}
      {num('joinery.field.mullion', spec.frame.mullion, (v) => frame({ mullion: v }))}
      {num('joinery.field.transom', spec.frame.transom, (v) => frame({ transom: v }))}
      <NumberField label={t('joinery.field.offset')} value={spec.frame.offset} min={-10_000} onChange={(v) => v !== undefined && frame({ offset: v })} />
      {num('joinery.field.sashWidth', spec.sash.width, (v) => sash({ width: v }))}
      {num('joinery.field.sashDepth', spec.sash.depth, (v) => v > 0 && sash({ depth: v }), 1)}
      {spec.kind === 'door' ? num('joinery.field.leaf', spec.sash.leafThickness, (v) => v > 0 && sash({ leafThickness: v }), 1) : null}
      {num('joinery.field.glass', spec.sash.glassThickness, (v) => v > 0 && sash({ glassThickness: v }), 1)}
    </Section>
  );
}

export function FinishFields({ spec, onChange }: Props) {
  const { t } = useTranslation();
  const color = (key: keyof JoinerySpec['colors']) => (v: string) => onChange({ ...spec, colors: { ...spec.colors, [key]: v } });
  return (
    <Section title={t('joinery.section.finish')}>
      {spec.kind === 'window' ? (
        <>
          <NumberField label={t('joinery.field.boardIn')} value={spec.board.interior} onChange={(v) => v !== undefined && onChange({ ...spec, board: { ...spec.board, interior: v } })} />
          <NumberField label={t('joinery.field.boardOut')} value={spec.board.exterior} onChange={(v) => v !== undefined && onChange({ ...spec, board: { ...spec.board, exterior: v } })} />
        </>
      ) : (
        <NumberField label={t('joinery.field.threshold')} value={spec.threshold} onChange={(v) => v !== undefined && onChange({ ...spec, threshold: v })} />
      )}
      <div className="flex flex-wrap gap-3 pt-1">
        <ColorField label={t('joinery.field.colorFrame')} value={spec.colors.frame} onChange={color('frame')} />
        <ColorField label={t('joinery.field.colorGlass')} value={spec.colors.glass} onChange={color('glass')} />
        {spec.kind === 'door' ? <ColorField label={t('joinery.field.colorLeaf')} value={spec.colors.leaf} onChange={color('leaf')} /> : null}
      </div>
    </Section>
  );
}

export function PropertyFields({ spec, onChange }: Props) {
  const { t } = useTranslation();
  const props = (patch: Partial<JoinerySpec['props']>) => onChange({ ...spec, props: { ...spec.props, ...patch } });
  const text = (key: TranslationKey, field: 'fireRating' | 'acousticRating' | 'securityRating') => (
    <TextField label={t(key)} value={spec.props[field] ?? ''} onChange={(v) => props({ [field]: v || undefined })} />
  );
  return (
    <Section title={t('joinery.section.props', { kind: spec.kind === 'door' ? 'Door' : 'Window' })}>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={spec.props.isExternal} onChange={(e) => props({ isExternal: e.target.checked })} />
        {t('joinery.field.external')}
      </label>
      <NumberField label={t('joinery.field.uValue')} value={spec.props.thermalTransmittance} plain optional onChange={(v) => props({ thermalTransmittance: v })} />
      {text('joinery.field.fire', 'fireRating')}
      {text('joinery.field.acoustic', 'acousticRating')}
      {text('joinery.field.security', 'securityRating')}
    </Section>
  );
}
