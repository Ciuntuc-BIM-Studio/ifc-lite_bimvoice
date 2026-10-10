/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The configurator's grid: column widths and row heights (clear sizes in
 * millimetres; the others share what is left), adding and removing columns
 * and rows, and for the panel picked in the elevation its operation — each
 * button drawn with the official symbol it produces — merging it with the
 * next cell right or up, and splitting it again.
 */

import { ArrowRight, ArrowUp, Minus, Plus, Ungroup } from 'lucide-react';
import { useOpeningConvention } from '@/joinery/opening-convention';
import {
  DOOR_OPERATIONS, WINDOW_OPERATIONS, gridExtents, isDoorLeaf, normalisedPanels,
  type JoineryPanel, type JoinerySpec, type PanelOperation,
} from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { openingMarks } from '@/joinery/symbols';
import { NumberField, Section } from './JoineryFields';

interface Props {
  spec: JoinerySpec;
  onChange: (spec: JoinerySpec) => void;
  /** The picked panel, by its bottom-left cell (stable while the panel changes). */
  selected: Cell | null;
  onSelect: (cell: Cell | null) => void;
}

export interface Cell { col: number; row: number }

/** Resize item `i` to `size` (metres, clear); the others keep their proportions in what is left. */
function resized(weights: readonly number[], extents: readonly [number, number][], i: number, size: number): number[] {
  const sizes = extents.map(([a, b]) => b - a);
  const total = sizes.reduce((s, v) => s + v, 0);
  const rest = total - size, othersNow = total - sizes[i];
  if (size <= 0.01 || rest <= 0.01 * (sizes.length - 1) || othersNow <= 0) return [...weights];
  return sizes.map((v, j) => (j === i ? size : v * rest / othersNow));
}

function OperationIcon({ op }: { op: PanelOperation }) {
  const r = { x0: 2, x1: 22, z0: 2, z1: 26 };
  const marks = openingMarks(op, r, false, useOpeningConvention());
  return (
    <svg width={24} height={28} viewBox="0 0 24 28" aria-hidden="true">
      <rect x={2} y={2} width={20} height={24} fill="none" stroke="currentColor" strokeWidth={1.2} />
      {marks.map((m, i) => (
        <path key={i} d={m.pts.map((p, j) => `${j ? 'L' : 'M'}${p.x},${28 - p.y}`).join('')} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray={m.dashed ? '2 2' : undefined} />
      ))}
    </svg>
  );
}

export function JoineryGrid({ spec, onChange, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const { cols, rows } = gridExtents(spec);
  const panels = normalisedPanels(spec);
  const panel = selected ? panels.find((p) => p.col === selected.col && p.row === selected.row) ?? null : null;

  const setPanels = (next: JoineryPanel[]) => onChange({ ...spec, panels: next });
  const withPanel = (patch: Partial<JoineryPanel>) => {
    if (!panel) return;
    const rest = normalisedPanels(spec).filter((p) => !(p.col === panel.col && p.row === panel.row));
    const updated = { ...panel, ...patch };
    // Cells the panel now covers lose their own panels.
    const covers = (p: JoineryPanel) => p.col >= updated.col && p.col < updated.col + (updated.colSpan ?? 1) && p.row >= updated.row && p.row < updated.row + (updated.rowSpan ?? 1);
    setPanels([updated, ...rest.filter((p) => !covers(p))]);
  };
  const addColumn = () => onChange({ ...spec, columns: [...spec.columns, spec.columns.reduce((s, v) => s + v, 0) / spec.columns.length] });
  const removeColumn = () => {
    if (spec.columns.length < 2) return;
    const last = spec.columns.length - 1;
    onChange({ ...spec, columns: spec.columns.slice(0, -1), panels: spec.panels.filter((p) => p.col < last) });
    onSelect(null);
  };
  const addRow = () => onChange({ ...spec, rows: [...spec.rows, spec.rows.reduce((s, v) => s + v, 0) / spec.rows.length / 3] });
  const removeRow = () => {
    if (spec.rows.length < 2) return;
    const last = spec.rows.length - 1;
    onChange({ ...spec, rows: spec.rows.slice(0, -1), panels: spec.panels.filter((p) => p.row < last) });
    onSelect(null);
  };
  const operations = spec.kind === 'door' ? ['fixed' as const, ...DOOR_OPERATIONS, ...WINDOW_OPERATIONS.filter((o) => o !== 'fixed')] : WINDOW_OPERATIONS;

  return (
    <>
      <Section title={t('joinery.section.grid')}>
        <div className="flex items-center justify-between text-xs">
          <span>{t('joinery.field.columns')}: {spec.columns.length}</span>
          <span className="flex">
            <IconButton label={t('joinery.field.removeColumn')} className="size-6" disabled={spec.columns.length < 2} onClick={removeColumn}><Minus className="size-3.5" /></IconButton>
            <IconButton label={t('joinery.field.addColumn')} className="size-6" disabled={spec.columns.length >= 12} onClick={addColumn}><Plus className="size-3.5" /></IconButton>
          </span>
        </div>
        {spec.columns.length > 1 ? cols.map(([a, b], i) => (
          <NumberField key={`c${i}`} label={t('joinery.field.column', { n: i + 1 })} value={b - a}
            onChange={(v) => v !== undefined && onChange({ ...spec, columns: resized(spec.columns, cols, i, v) })} />
        )) : null}
        <div className="flex items-center justify-between pt-1 text-xs">
          <span>{t('joinery.field.rows')}: {spec.rows.length}</span>
          <span className="flex">
            <IconButton label={t('joinery.field.removeRow')} className="size-6" disabled={spec.rows.length < 2} onClick={removeRow}><Minus className="size-3.5" /></IconButton>
            <IconButton label={t('joinery.field.addRow')} className="size-6" disabled={spec.rows.length >= 12} onClick={addRow}><Plus className="size-3.5" /></IconButton>
          </span>
        </div>
        {spec.rows.length > 1 ? rows.map(([a, b], i) => (
          <NumberField key={`r${i}`} label={t('joinery.field.row', { n: i + 1 })} value={b - a}
            onChange={(v) => v !== undefined && onChange({ ...spec, rows: resized(spec.rows, rows, i, v) })} />
        )) : null}
      </Section>
      <Section title={t('joinery.section.panel')}>
        {panel ? (
          <>
            <div className="grid grid-cols-6 gap-1">
              {operations.map((op) => (
                <button
                  key={op} type="button" aria-pressed={panel.operation === op} title={t(`joinery.op.${op}` as TranslationKey)}
                  aria-label={t(`joinery.op.${op}` as TranslationKey)}
                  className={`flex items-center justify-center rounded-sm border p-0.5 ${panel.operation === op ? 'border-primary bg-primary/10 text-primary' : 'border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'}`}
                  onClick={() => withPanel({ operation: op })}
                >
                  <OperationIcon op={op} />
                </button>
              ))}
            </div>
            <p className="text-2xs text-zinc-500">{t(`joinery.op.${panel.operation}` as TranslationKey)}</p>
            <div className="flex items-center gap-1">
              <IconButton label={t('joinery.field.spanRight')} className="size-7" disabled={panel.col + (panel.colSpan ?? 1) >= spec.columns.length}
                onClick={() => withPanel({ colSpan: (panel.colSpan ?? 1) + 1 })}><ArrowRight className="size-3.5" /></IconButton>
              <IconButton label={t('joinery.field.spanUp')} className="size-7" disabled={panel.row + (panel.rowSpan ?? 1) >= spec.rows.length}
                onClick={() => withPanel({ rowSpan: (panel.rowSpan ?? 1) + 1 })}><ArrowUp className="size-3.5" /></IconButton>
              <IconButton label={t('joinery.field.split')} className="size-7" disabled={(panel.colSpan ?? 1) === 1 && (panel.rowSpan ?? 1) === 1}
                onClick={() => withPanel({ colSpan: 1, rowSpan: 1 })}><Ungroup className="size-3.5" /></IconButton>
              {isDoorLeaf(panel.operation) ? (
                <label className="ml-2 flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={!!panel.glazed} onChange={(e) => withPanel({ glazed: e.target.checked || undefined })} />
                  {t('joinery.field.glazed')}
                </label>
              ) : null}
            </div>
          </>
        ) : <p className="text-xs text-zinc-500">{t('joinery.panel.pick')}</p>}
      </Section>
    </>
  );
}
