/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A joinery schedule's primitives as SVG, in paper millimetres — in its own
 * tab and on sheets alike — tagged for the DXF exporter (layer SCHEDULE for
 * the table, SCHEDULE-SYMBOLS for the drawings). `useScheduleLayout` reads
 * the schedule live: it follows model edits and the catalogue.
 */

import { memo, useMemo } from 'react';
import type { PanelOperation } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import type { ProjectSchedule, ProjectSheet } from '@/project/types';
import { scheduleData, type ScheduleData } from '@/joinery/schedule-data';
import { layoutSchedule, type ScheduleLabels, type ScheduleLayout, type SchedulePrim } from '@/joinery/schedule-layout';
import { penTags } from '../sheets/dxf-tags';

const FONT = 'ui-sans-serif, system-ui, sans-serif';

export function useScheduleLabels(title: string): ScheduleLabels {
  const { t } = useTranslation();
  return useMemo(() => ({
    title,
    mark: t('schedule.row.mark'), name: t('schedule.row.name'), size: t('schedule.row.size'), operation: t('schedule.row.operation'),
    sill: t('schedule.row.sill'), total: t('schedule.row.total'), uValue: t('schedule.row.uValue'), fire: t('schedule.row.fire'),
    op: (op: PanelOperation) => t(`joinery.op.${op}` as TranslationKey),
  }), [t, title]);
}

/** The schedule's data and layout, recomputed when the models or the catalogue change. */
export function useScheduleLayout(schedule: ProjectSchedule | undefined): { data: ScheduleData; layout: ScheduleLayout } | null {
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const models = useViewerStore((s) => s.models);
  const catalogue = useProjectStore((s) => s.joineryTypes);
  const labels = useScheduleLabels(schedule?.name ?? '');
  return useMemo(() => {
    if (!schedule) return null;
    const data = scheduleData(schedule.kind);
    return { data, layout: layoutSchedule(data, labels, { scale: schedule.scale ?? 50 }) };
    // mutationVersion / models / catalogue: the inputs `scheduleData` reads from the stores.
  }, [schedule, labels, mutationVersion, models, catalogue]);
}

/** The layouts of the schedules placed on `sheet`, by schedule id. */
export function useSheetSchedules(sheet: ProjectSheet): Map<string, ScheduleLayout> {
  const schedules = useProjectStore((s) => s.schedules);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const models = useViewerStore((s) => s.models);
  const catalogue = useProjectStore((s) => s.joineryTypes);
  const labels = useScheduleLabels('');
  return useMemo(() => {
    const out = new Map<string, ScheduleLayout>();
    for (const vp of sheet.viewports ?? []) {
      const schedule = schedules?.find((s) => s.id === vp.viewId);
      if (!schedule || out.has(schedule.id)) continue;
      out.set(schedule.id, layoutSchedule(scheduleData(schedule.kind), { ...labels, title: schedule.name }, { scale: schedule.scale ?? 50 }));
    }
    return out;
    // mutationVersion / models / catalogue: the inputs `scheduleData` reads from the stores.
  }, [sheet.viewports, schedules, labels, mutationVersion, models, catalogue]);
}

function Prim({ p }: { p: SchedulePrim }) {
  if (p.kind === 'line') {
    return <line {...penTags('SCHEDULE', p.w)} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="#000" strokeWidth={p.w} />;
  }
  if (p.kind === 'path') {
    const d = p.pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join('') + (p.closed ? 'Z' : '');
    return <path {...penTags('SCHEDULE-SYMBOLS', p.w, !!p.dashed)} d={d} fill="none" stroke="#000" strokeWidth={p.w} strokeDasharray={p.dashed ? '1.2 0.8' : undefined} strokeLinejoin="round" />;
  }
  return (
    <text
      {...penTags('SCHEDULE', 0.18)} x={p.x} y={p.y} fontSize={p.size} fontFamily={FONT} fontWeight={p.bold ? 700 : 400} fill="#000"
      textAnchor={p.anchor} transform={p.rotate ? `rotate(${p.rotate} ${p.x} ${p.y})` : undefined}
    >
      {p.text}
    </text>
  );
}

/** The schedule at (x, y) on the paper (its top-left corner). */
export const ScheduleGraphic = memo(function ScheduleGraphic({ layout, x = 0, y = 0 }: { layout: ScheduleLayout; x?: number; y?: number }) {
  return (
    <g transform={x || y ? `translate(${x} ${y})` : undefined}>
      {layout.prims.map((p, i) => <Prim key={i} p={p} />)}
    </g>
  );
});
