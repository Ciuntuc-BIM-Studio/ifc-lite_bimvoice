/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Text and dimension style editors: the styles on the left (the current one
 * — what new annotations take — marked, duplicate / delete), the selected
 * style's fields on the right, applied at once to every annotation using it.
 * The dimension editor previews a horizontal and a vertical dimension.
 */

import { useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useProjectStore } from '@/project/project-store';
import {
  addDimStyle, addTextStyle, removeDimStyle, removeTextStyle, updateDimStyle, updateTextStyle,
} from '@/project/drafting-standards';
import { useStandardsDialog } from '@/project/standards-dialog-store';
import { currentStyles, setCurrentStyles, useDraftingSession } from '@/drafting/session';
import {
  DEFAULT_DIM_STYLE, DEFAULT_TEXT_STYLE, STANDARD,
  type ArrowKind, type DimStyle, type FontKind, type LengthUnit, type TextPlacement, type TextStyle,
} from '@/drafting/styles';
import type { AnnotationShape } from '@/drafting/types';
import { AnnotationGraphics } from '../AnnotationGraphics';

const INPUT = 'h-7 w-32 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

function NumberField({ label, value, min = 0, step = 0.1, onCommit }: { label: string; value: number; min?: number; step?: number; onCommit: (v: number) => void }) {
  return (
    <input type="number" aria-label={label} className={`${INPUT} text-right tabular-nums`} min={min} step={step} defaultValue={value} key={value}
      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min && v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function StyleList<S extends { id: string; name: string }>({ styles, selected, current, onSelect, onDuplicate, onDelete }: {
  styles: readonly S[]; selected: string; current: string; onSelect: (id: string) => void; onDuplicate: (s: S) => void; onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="w-48 shrink-0 space-y-0.5 border-r border-zinc-200 pr-2 dark:border-zinc-800">
      {styles.map((s) => (
        <li key={s.id} className={`flex items-center gap-1 rounded-sm px-1 ${s.id === selected ? 'bg-primary/10' : ''}`}>
          <button type="button" className="min-w-0 flex-1 truncate py-1 text-left" onClick={() => onSelect(s.id)}>
            {s.name}{s.id === current ? <span className="ml-1 text-2xs text-primary">{t('standards.style.current')}</span> : null}
          </button>
          <IconButton label={`${t('standards.style.duplicate')} ${s.name}`} className="size-6" onClick={() => onDuplicate(s)}><Copy className="size-3" /></IconButton>
          {s.id !== STANDARD ? <IconButton label={`${t('standards.style.delete')} ${s.name}`} className="size-6" onClick={() => onDelete(s.id)}><Trash2 className="size-3" /></IconButton> : null}
        </li>
      ))}
    </ul>
  );
}

function ColorChoice({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={value === undefined} onChange={(e) => onChange(e.target.checked ? undefined : '#000000')} />
        {t('standards.style.byLayer')}
      </label>
      {value !== undefined ? <input type="color" aria-label={label} className="h-7 w-9 rounded-sm border border-zinc-300 dark:border-zinc-700" value={value} onChange={(e) => onChange(e.target.value)} /> : null}
    </div>
  );
}

function useSelected(styles: readonly { id: string }[]): [string, (id: string) => void] {
  const wanted = useStandardsDialog((s) => s.styleId);
  const [picked, setPicked] = useState<string | null>(null);
  const id = picked ?? wanted ?? STANDARD;
  return [styles.some((s) => s.id === id) ? id : STANDARD, setPicked];
}

export function TextStylesTab() {
  const { t } = useTranslation();
  useDraftingSession((s) => s.revision);
  const styles = useProjectStore((s) => s.textStyles) ?? [DEFAULT_TEXT_STYLE];
  const [selected, select] = useSelected(styles);
  const style = styles.find((s) => s.id === selected) ?? DEFAULT_TEXT_STYLE;
  const set = (patch: Partial<TextStyle>) => {
    updateTextStyle(style.id, patch);
    if (patch.height && currentStyles().textStyle === style.id) setCurrentStyles({ textHeightMm: patch.height });
  };
  return (
    <div className="flex gap-4 text-xs">
      <StyleList styles={styles} selected={selected} current={currentStyles().textStyle} onSelect={select}
        onDuplicate={(s) => select(addTextStyle(s, t('standards.style.copyName', { name: s.name })))} onDelete={removeTextStyle} />
      <div className="flex-1 space-y-1">
        <Row label={t('standards.style.name')}>
          <input aria-label={t('standards.style.name')} className={INPUT} defaultValue={style.name} key={style.id + style.name} onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })} />
        </Row>
        <Row label={t('standards.text.height')}><NumberField label={t('standards.text.height')} value={style.height} min={0.5} onCommit={(height) => set({ height })} /></Row>
        <Row label={t('standards.text.font')}>
          <SegmentedControl size="sm" label={t('standards.text.font')} value={style.font} onValueChange={(font: FontKind) => set({ font })}
            options={(['sans', 'serif', 'mono'] as const).map((f) => ({ value: f, label: t(`standards.text.font.${f}` as TranslationKey) }))} />
        </Row>
        <Row label={t('standards.text.bold')}><input type="checkbox" checked={style.bold} onChange={(e) => set({ bold: e.target.checked })} /></Row>
        <Row label={t('standards.text.italic')}><input type="checkbox" checked={style.italic} onChange={(e) => set({ italic: e.target.checked })} /></Row>
        <Row label={t('standards.text.color')}><ColorChoice label={t('standards.text.color')} value={style.color} onChange={(color) => set({ color })} /></Row>
        <Button size="sm" variant="outline" disabled={currentStyles().textStyle === style.id} onClick={() => setCurrentStyles({ textStyle: style.id, textHeightMm: style.height })}>
          {t('standards.style.makeCurrent')}
        </Button>
      </div>
    </div>
  );
}

const PREVIEW: AnnotationShape[] = [
  { type: 'dimension', variant: 'aligned', a: { x: 0.4, y: 0.4 }, b: { x: 3.4, y: 0.4 }, at: { x: 1.9, y: 0.9 }, height: 0.25 },
  { type: 'dimension', variant: 'aligned', a: { x: 4.4, y: 0.4 }, b: { x: 4.4, y: 2.4 }, at: { x: 3.9, y: 1.4 }, height: 0.25 },
];

function DimPreview({ dim, text }: { dim: DimStyle; text: TextStyle }) {
  const { t } = useTranslation();
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800">
      <svg width={300} height={170} aria-hidden="true">
        {PREVIEW.map((shape, i) => (
          <AnnotationGraphics key={i} shape={{ ...shape, height: (text.height * 100) / 1000 } as AnnotationShape} color="#18181b" selected={false}
            transform={{ scale: 55, x: 10, y: 160 }} axis="front" extraPatterns={[]} look={{ text, dim }} paperUnit={0.1} />
        ))}
      </svg>
      <figcaption className="text-2xs text-zinc-500">{t('standards.dim.preview')}</figcaption>
    </figure>
  );
}

export function DimStylesTab() {
  const { t } = useTranslation();
  useDraftingSession((s) => s.revision);
  const styles = useProjectStore((s) => s.dimStyles) ?? [DEFAULT_DIM_STYLE];
  const textStyles = useProjectStore((s) => s.textStyles) ?? [DEFAULT_TEXT_STYLE];
  const [selected, select] = useSelected(styles);
  const style = styles.find((s) => s.id === selected) ?? DEFAULT_DIM_STYLE;
  const set = (patch: Partial<DimStyle>) => updateDimStyle(style.id, patch);
  const text = textStyles.find((s) => s.id === style.textStyle) ?? DEFAULT_TEXT_STYLE;
  return (
    <div className="flex gap-4 text-xs">
      <StyleList styles={styles} selected={selected} current={currentStyles().dimStyle} onSelect={select}
        onDuplicate={(s) => select(addDimStyle(s, t('standards.style.copyName', { name: s.name })))} onDelete={removeDimStyle} />
      <div className="flex-1 space-y-1">
        <Row label={t('standards.style.name')}>
          <input aria-label={t('standards.style.name')} className={INPUT} defaultValue={style.name} key={style.id + style.name} onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })} />
        </Row>
        <Row label={t('standards.dim.textStyle')}>
          <select aria-label={t('standards.dim.textStyle')} className={INPUT} value={style.textStyle} onChange={(e) => set({ textStyle: e.target.value })}>
            {textStyles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Row>
        <Row label={t('standards.dim.placement')}>
          <SegmentedControl size="sm" label={t('standards.dim.placement')} value={style.placement} onValueChange={(placement: TextPlacement) => set({ placement })}
            options={(['above', 'centered', 'below'] as const).map((p) => ({ value: p, label: t(`standards.dim.placement.${p}` as TranslationKey) }))} />
        </Row>
        <Row label={t('standards.dim.textGap')}><NumberField label={t('standards.dim.textGap')} value={style.textGap} onCommit={(textGap) => set({ textGap })} /></Row>
        <Row label={t('standards.dim.arrow')}>
          <SegmentedControl size="sm" label={t('standards.dim.arrow')} value={style.arrow} onValueChange={(arrow: ArrowKind) => set({ arrow })}
            options={(['tick', 'arrow', 'dot', 'none'] as const).map((a) => ({ value: a, label: t(`standards.dim.arrow.${a}` as TranslationKey) }))} />
        </Row>
        <Row label={t('standards.dim.arrowSize')}><NumberField label={t('standards.dim.arrowSize')} value={style.arrowSize} onCommit={(arrowSize) => set({ arrowSize })} /></Row>
        <Row label={t('standards.dim.extGap')}><NumberField label={t('standards.dim.extGap')} value={style.extGap} onCommit={(extGap) => set({ extGap })} /></Row>
        <Row label={t('standards.dim.extOver')}><NumberField label={t('standards.dim.extOver')} value={style.extOver} onCommit={(extOver) => set({ extOver })} /></Row>
        <Row label={t('standards.dim.unit')}>
          <SegmentedControl size="sm" label={t('standards.dim.unit')} value={style.unit} onValueChange={(unit: LengthUnit) => set({ unit })}
            options={(['m', 'cm', 'mm'] as const).map((u) => ({ value: u, label: u }))} />
        </Row>
        <Row label={t('standards.dim.precision')}><NumberField label={t('standards.dim.precision')} value={style.precision} step={1} onCommit={(precision) => set({ precision: Math.min(6, Math.round(precision)) })} /></Row>
        <Row label={t('standards.text.color')}><ColorChoice label={t('standards.text.color')} value={style.color} onChange={(color) => set({ color })} /></Row>
        <Button size="sm" variant="outline" disabled={currentStyles().dimStyle === style.id} onClick={() => setCurrentStyles({ dimStyle: style.id })}>
          {t('standards.style.makeCurrent')}
        </Button>
      </div>
      <div className="w-[320px] shrink-0 space-y-2">
        <DimPreview dim={style} text={text} />
        <p className="text-2xs text-zinc-500">{t('standards.dim.rule')}</p>
      </div>
    </div>
  );
}
