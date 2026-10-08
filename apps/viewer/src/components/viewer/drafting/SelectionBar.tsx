/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * On-canvas editing of the selected annotation: a compact bar floating just
 * above it — style, where a dimension's value sits, its ends, bold / italic
 * and text size steps, edit text, reset to style — and the inline text
 * editor (also opened by double-clicking the annotation). Every change is an
 * element override (`drafting-standards.ts`), so the style keeps governing
 * what the element does not override.
 */

import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Minus, Pencil, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { editDrafts } from '@/drafting/draft-store';
import { entityBounds } from '@/drafting/annotation';
import { drawingToScreen, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { overriddenFields, resolveDim, resolveText, type ArrowKind, type TextPlacement } from '@/drafting/styles';
import { isGeometry, type AnnotationShape, type DraftEntity, type Pt } from '@/drafting/types';
import { resetElementOverrides, setElementOverride, setElementStyle } from '@/project/drafting-standards';
import { openStandards } from '@/project/standards-dialog-store';
import { isDimensional, useStyleBook } from './AnnotationStyleFields';

const BTN = 'h-7 whitespace-nowrap rounded-sm px-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800';
const BAR_HALF = 250;
const SELECT = 'h-7 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs';

/** The text an annotation shows (and the inline editor edits); null for those without one. */
export function editableText(shape: AnnotationShape): string | null {
  if (shape.type === 'text' || shape.type === 'leader') return shape.text;
  if (shape.type === 'dimension') return shape.text ?? '';
  return null;
}

function withText(shape: AnnotationShape, text: string): AnnotationShape {
  if (shape.type === 'text' || shape.type === 'leader') return { ...shape, text };
  if (shape.type === 'dimension') {
    const { text: _old, ...rest } = shape;
    return text.trim() ? { ...rest, text } : rest;
  }
  return shape;
}

interface Props {
  entity: DraftEntity;
  transform: ViewTransform;
  axis: SectionAxisName;
  /** Open the inline editor (a double-click asks for it too). */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** The drawing area's width (px): the bar stays inside it. */
  areaWidth: number;
}

export function SelectionBar({ entity, transform, axis, editing, onEditingChange, areaWidth }: Props) {
  const { t } = useTranslation();
  const book = useStyleBook();
  const shape = entity.shape;
  if (isGeometry(shape) || shape.type === 'hatch') return null;
  const ids = new Set([entity.id]);
  const dimensional = isDimensional(shape);
  const kind = dimensional ? 'dimStyle' : 'textStyle';
  const text = resolveText(book, entity.params);
  const dim = resolveDim(book, entity.params);
  const bounds = entityBounds(shape);
  // Above the element on screen: the top of its screen-space bounds.
  const corners: Pt[] = [bounds.min, bounds.max, { x: bounds.min.x, y: bounds.max.y }, { x: bounds.max.x, y: bounds.min.y }].map((p) => drawingToScreen(p, transform, axis));
  const top = Math.min(...corners.map((p) => p.y));
  const centre = (Math.min(...corners.map((p) => p.x)) + Math.max(...corners.map((p) => p.x))) / 2;
  // Centred over the element, but never past the drawing area's edges (half the bar is ~240 px).
  const left = Math.min(Math.max(centre, BAR_HALF), Math.max(BAR_HALF, areaWidth - BAR_HALF));
  const editable = editableText(shape);
  const label = (placement: TextPlacement) => t(`standards.dim.placement.${placement}` as TranslationKey);

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('standards.el.style')}
        className="absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border border-zinc-200 bg-white/95 p-0.5 shadow-md dark:border-zinc-700 dark:bg-zinc-900/95 cursor-auto"
        style={{ left, top: Math.max(top - 10, 40) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <select aria-label={t('standards.el.style')} className={SELECT} value={String(entity.params[kind] ?? 'standard')} onChange={(e) => setElementStyle(ids, kind, e.target.value)}>
          {(dimensional ? book.dimStyles : book.textStyles).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {dimensional ? (
          <>
            {(['above', 'centered', 'below'] as const).map((p) => (
              <button key={p} type="button" aria-pressed={dim.placement === p} className={`${BTN} ${dim.placement === p ? 'bg-primary/15 text-primary' : ''}`} onClick={() => setElementOverride(ids, 'placement', p)}>
                {label(p)}
              </button>
            ))}
            <select aria-label={t('standards.dim.arrow')} className={SELECT} value={dim.arrow} onChange={(e) => setElementOverride(ids, 'arrow', e.target.value as ArrowKind)}>
              {(['tick', 'arrow', 'dot', 'none'] as const).map((a) => <option key={a} value={a}>{t(`standards.dim.arrow.${a}` as TranslationKey)}</option>)}
            </select>
          </>
        ) : null}
        <IconButton label={t('standards.text.bold')} className="size-7" aria-pressed={text.bold} onClick={() => setElementOverride(ids, 'bold', !text.bold)}><Bold className="size-3.5" /></IconButton>
        <IconButton label={t('standards.text.italic')} className="size-7" aria-pressed={text.italic} onClick={() => setElementOverride(ids, 'italic', !text.italic)}><Italic className="size-3.5" /></IconButton>
        <IconButton label={`${t('standards.el.height')} −`} className="size-7" onClick={() => setElementOverride(ids, 'height', Math.max(0.5, text.height - 0.5))}><Minus className="size-3.5" /></IconButton>
        <span className="min-w-8 text-center text-xs tabular-nums">{text.height.toFixed(1)}</span>
        <IconButton label={`${t('standards.el.height')} +`} className="size-7" onClick={() => setElementOverride(ids, 'height', text.height + 0.5)}><Plus className="size-3.5" /></IconButton>
        {editable !== null ? (
          <IconButton label={t('standards.el.editText')} className="size-7" onClick={() => onEditingChange(true)}><Pencil className="size-3.5" /></IconButton>
        ) : null}
        <IconButton label={t('standards.el.reset')} className="size-7" disabled={overriddenFields(entity.params).length === 0} onClick={() => resetElementOverrides(ids)}><RotateCcw className="size-3.5" /></IconButton>
        <IconButton label={t('standards.open')} className="size-7" onClick={() => openStandards(dimensional ? 'dim' : 'text', String(entity.params[kind] ?? 'standard'))}><SlidersHorizontal className="size-3.5" /></IconButton>
      </div>
      {editing && editable !== null ? (
        <InlineEditor entity={entity} value={editable} at={{ x: left, y: top }} onDone={() => onEditingChange(false)} />
      ) : null}
    </>
  );
}

function InlineEditor({ entity, value, at, onDone }: { entity: DraftEntity; value: string; at: Pt; onDone: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => {
    if (text !== value) editDrafts({ update: new Map([[entity.id, withText(entity.shape as AnnotationShape, text)]]) });
    onDone();
  };
  return (
    <input
      ref={ref}
      aria-label={t('standards.el.editText')}
      className="absolute z-30 h-8 min-w-48 -translate-x-1/2 rounded-md border-2 border-primary bg-white px-2 text-sm text-zinc-900 shadow-lg outline-none"
      style={{ left: at.x, top: at.y + 4 }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onDone();
      }}
    />
  );
}
