/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Editable fields of one selected annotation: its text, text height, a
 * dimension's text override, a level mark's value, a hatch's pattern /
 * scale / angle. Each change is one undoable drafting edit.
 */

import { useTranslation } from '@/i18n';
import { editDrafts } from '@/drafting/draft-store';
import { builtInPatterns } from '@/drafting/hatch/library';
import type { HatchPattern } from '@/drafting/hatch/pattern';
import type { AnnotationShape, DraftEntity } from '@/drafting/types';

const INPUT = 'w-32 h-6 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1';

function update(entity: DraftEntity, shape: AnnotationShape): void {
  editDrafts({ update: new Map([[entity.id, shape]]) });
}

function Field({ label, value, onCommit, numeric }: { label: string; value: string; onCommit: (v: string) => void; numeric?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <input
        aria-label={label}
        className={INPUT}
        inputMode={numeric ? 'decimal' : undefined}
        defaultValue={value}
        key={value}
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

const positive = (text: string, fallback: number) => {
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const finite = (text: string, fallback: number) => {
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};

export function AnnotationFields({ entity, shape, extraPatterns }: { entity: DraftEntity; shape: AnnotationShape; extraPatterns: readonly HatchPattern[] }) {
  const { t } = useTranslation();
  if (shape.type === 'hatch') {
    const names = [...new Set([...extraPatterns, ...builtInPatterns()].map((p) => p.name))];
    return (
      <>
        <label className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-zinc-500">{t('drafting.props.pattern')}</span>
          <select
            aria-label={t('drafting.props.pattern')}
            className={INPUT}
            value={shape.pattern}
            onChange={(e) => update(entity, { ...shape, pattern: e.target.value })}
          >
            {names.includes(shape.pattern) ? null : <option value={shape.pattern}>{shape.pattern}</option>}
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Field label={t('drafting.props.scale')} value={String(shape.scale)} numeric onCommit={(v) => update(entity, { ...shape, scale: positive(v, shape.scale) })} />
        <Field label={t('drafting.props.hatchAngle')} value={String(shape.angle)} numeric onCommit={(v) => update(entity, { ...shape, angle: finite(v, shape.angle) })} />
      </>
    );
  }
  const height = (
    <Field label={t('drafting.props.height')} value={String(shape.height)} numeric onCommit={(v) => update(entity, { ...shape, height: positive(v, shape.height) })} />
  );
  switch (shape.type) {
    case 'text':
    case 'leader':
      return (
        <>
          <Field label={t('drafting.props.text')} value={shape.text} onCommit={(v) => update(entity, { ...shape, text: v })} />
          {height}
        </>
      );
    case 'dimension':
      return (
        <>
          <Field
            label={t('drafting.props.override')}
            value={shape.text ?? ''}
            onCommit={(v) => {
              const { text: _previous, ...rest } = shape;
              update(entity, v.trim() ? { ...rest, text: v } : rest);
            }}
          />
          {height}
        </>
      );
    case 'level':
      return (
        <>
          <Field label={t('drafting.props.value')} value={String(shape.value)} numeric onCommit={(v) => update(entity, { ...shape, value: finite(v, shape.value) })} />
          {height}
        </>
      );
    default:
      return height;
  }
}
