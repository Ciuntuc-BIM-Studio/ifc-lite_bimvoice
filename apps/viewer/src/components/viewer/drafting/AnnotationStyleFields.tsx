/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * An annotation's style and its element overrides, in the properties panel:
 * the style it follows, then every field it can override — showing the
 * value it is drawn with, marked when the element overrides it, each with
 * its own reset — and "Reset to style" for all of them at once.
 */

import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useProjectStore } from '@/project/project-store';
import { resetElementOverrides, setElementOverride, setElementStyle } from '@/project/drafting-standards';
import { openStandards } from '@/project/standards-dialog-store';
import {
  overriddenFields, overrideKey, resolveDim, resolveText,
  type ArrowKind, type FontKind, type LengthUnit, type StyleBook, type TextPlacement,
} from '@/drafting/styles';
import type { AnnotationShape, DraftEntity } from '@/drafting/types';

const INPUT = 'h-6 w-24 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1';

export const isDimensional = (shape: AnnotationShape) => shape.type === 'dimension' || shape.type === 'radial' || shape.type === 'angular';

function Line({ label, field, entity, children }: { label: string; field: string; entity: DraftEntity; children: React.ReactNode }) {
  const { t } = useTranslation();
  const own = entity.params[overrideKey(field)] !== undefined;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={own ? 'font-medium text-primary' : 'text-zinc-500'} title={own ? t('standards.el.overridden') : t('standards.el.byStyle')}>{label}</span>
      <div className="flex items-center gap-1">
        {children}
        <IconButton label={`${t('standards.el.reset')} · ${label}`} className="size-5" disabled={!own} onClick={() => setElementOverride(new Set([entity.id]), field, null)}>
          <RotateCcw className="size-3" />
        </IconButton>
      </div>
    </div>
  );
}

export function useStyleBook(): StyleBook {
  const textStyles = useProjectStore((s) => s.textStyles) ?? [];
  const dimStyles = useProjectStore((s) => s.dimStyles) ?? [];
  return { textStyles, dimStyles };
}

export function AnnotationStyleFields({ entity, shape }: { entity: DraftEntity; shape: AnnotationShape }) {
  const { t } = useTranslation();
  const book = useStyleBook();
  if (shape.type === 'hatch') return null;
  const ids = new Set([entity.id]);
  const dimensional = isDimensional(shape);
  const kind = dimensional ? 'dimStyle' : 'textStyle';
  const styles = dimensional ? book.dimStyles : book.textStyles;
  const text = resolveText(book, entity.params);
  const dim = resolveDim(book, entity.params);
  const set = (field: string, value: string | number | boolean) => setElementOverride(ids, field, value);
  const overridden = overriddenFields(entity.params).length > 0;
  return (
    <div className="space-y-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">{t('standards.el.style')}</span>
        <div className="flex items-center gap-1">
          <select aria-label={t('standards.el.style')} className={`${INPUT} w-32`} value={String(entity.params[kind] ?? 'standard')} onChange={(e) => setElementStyle(ids, kind, e.target.value)}>
            {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <IconButton label={t('standards.open')} className="size-5" onClick={() => openStandards(dimensional ? 'dim' : 'text', String(entity.params[kind] ?? 'standard'))}>
            <SlidersHorizontal className="size-3" />
          </IconButton>
        </div>
      </div>
      <Line label={t('standards.el.height')} field="height" entity={entity}>
        <input type="number" aria-label={t('standards.el.height')} className={`${INPUT} text-right`} min={0.5} step={0.25} defaultValue={text.height} key={text.height}
          onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== text.height) set('height', v); }} />
      </Line>
      <Line label={t('standards.text.font')} field="font" entity={entity}>
        <select aria-label={t('standards.text.font')} className={INPUT} value={text.font} onChange={(e) => set('font', e.target.value as FontKind)}>
          {(['sans', 'serif', 'mono'] as const).map((f) => <option key={f} value={f}>{t(`standards.text.font.${f}` as TranslationKey)}</option>)}
        </select>
      </Line>
      <Line label={t('standards.text.bold')} field="bold" entity={entity}>
        <input type="checkbox" aria-label={t('standards.text.bold')} checked={text.bold} onChange={(e) => set('bold', e.target.checked)} />
      </Line>
      <Line label={t('standards.text.italic')} field="italic" entity={entity}>
        <input type="checkbox" aria-label={t('standards.text.italic')} checked={text.italic} onChange={(e) => set('italic', e.target.checked)} />
      </Line>
      {dimensional ? (
        <>
          <Line label={t('standards.dim.placement')} field="placement" entity={entity}>
            <SegmentedControl size="sm" label={t('standards.dim.placement')} value={dim.placement} onValueChange={(v: TextPlacement) => set('placement', v)}
              options={(['above', 'centered', 'below'] as const).map((p) => ({ value: p, label: t(`standards.dim.placement.${p}` as TranslationKey) }))} />
          </Line>
          <Line label={t('standards.dim.arrow')} field="arrow" entity={entity}>
            <select aria-label={t('standards.dim.arrow')} className={INPUT} value={dim.arrow} onChange={(e) => set('arrow', e.target.value as ArrowKind)}>
              {(['tick', 'arrow', 'dot', 'none'] as const).map((a) => <option key={a} value={a}>{t(`standards.dim.arrow.${a}` as TranslationKey)}</option>)}
            </select>
          </Line>
          <Line label={t('standards.dim.unit')} field="unit" entity={entity}>
            <select aria-label={t('standards.dim.unit')} className={INPUT} value={dim.unit} onChange={(e) => set('unit', e.target.value as LengthUnit)}>
              {(['m', 'cm', 'mm'] as const).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Line>
          <Line label={t('standards.dim.precision')} field="precision" entity={entity}>
            <input type="number" aria-label={t('standards.dim.precision')} className={`${INPUT} text-right`} min={0} max={6} step={1} defaultValue={dim.precision} key={dim.precision}
              onBlur={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 0 && v <= 6 && v !== dim.precision) set('precision', v); }} />
          </Line>
        </>
      ) : null}
      {overridden ? (
        <button type="button" className="w-full rounded-sm py-1 text-primary hover:bg-primary/10" onClick={() => resetElementOverrides(ids)}>
          {t('standards.el.reset')}
        </button>
      ) : null}
    </div>
  );
}
