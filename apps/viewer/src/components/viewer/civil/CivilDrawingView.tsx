/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A road drawing's tab: its settings on the left (scale, exaggeration and
 * grid for a profile; sample spacing or stations, columns and width for
 * sections), the drawing itself on the right, live from the corridor. It is
 * placed on a sheet by dragging it from the navigator (a viewport that
 * follows the corridor), or drawn on the plan with "Draw on plan" (Civil 3D
 * style, static drafted entities) — the user picks either.
 */

import { useMemo } from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import type { ProjectCivilDrawing } from '@/project/types';
import { buildCivilDrawing, layoutCivilDrawing, updateCivilDrawing } from '@/civil/civil-drawings';
import { drawCivilOnPlan } from '@/civil/civil-drawing-actions';
import { INPUT, Section } from '../joinery/JoineryFields';
import { CivilDrawingGraphic } from './CivilDrawingGraphic';
import { Cell } from './CorridorFields';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[1fr_6rem] items-center gap-2 text-xs">
      <span className="truncate text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export function CivilDrawingView({ drawing: d }: { drawing: ProjectCivilDrawing }) {
  const { t } = useTranslation();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const models = useViewerStore((s) => s.models);
  const built = useMemo(() => { void mutationVersion; void models; return buildCivilDrawing(d); }, [d, mutationVersion, models]);
  const layout = 'prims' in built ? layoutCivilDrawing(built, d.scale) : null;
  const set = (patch: Partial<ProjectCivilDrawing>) => updateCivilDrawing(d.id, patch);
  const pad = 15;
  return (
    <div className="flex h-full min-h-0 text-xs">
      <aside className="w-72 shrink-0 space-y-2 overflow-y-auto border-r border-zinc-200 p-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">{d.name}</h2>
        <Section title={t(d.kind === 'profile' ? 'civilDwg.zone.profile' : 'civilDwg.zone.sections')}>
          <Row label={t('civilDwg.field.scale')}><Cell label={t('civilDwg.field.scale')} value={d.scale} min={1} onCommit={(scale) => set({ scale })} /></Row>
          {d.kind === 'profile' ? (
            <>
              <Row label={t('civilDwg.field.vExaggeration')}><Cell label={t('civilDwg.field.vExaggeration')} value={d.vExaggeration ?? 10} min={1} onCommit={(vExaggeration) => set({ vExaggeration })} /></Row>
              <Row label={t('civilDwg.field.stationStep')}><Cell label={t('civilDwg.field.stationStep')} value={d.stationStep ?? 20} min={1} onCommit={(stationStep) => set({ stationStep })} /></Row>
              <Row label={t('civilDwg.field.elevationStep')}><Cell label={t('civilDwg.field.elevationStep')} value={d.elevationStep ?? 1} min={0.1} onCommit={(elevationStep) => set({ elevationStep })} /></Row>
            </>
          ) : (
            <>
              <Row label={t('civilDwg.field.every')}><Cell label={t('civilDwg.field.every')} value={d.every ?? 20} min={1} onCommit={(every) => set({ every })} /></Row>
              <label className="block space-y-1">
                <span className="text-zinc-600 dark:text-zinc-400">{t('civilDwg.field.stations')}</span>
                <input className={INPUT} defaultValue={(d.stations ?? []).join(', ')} key={(d.stations ?? []).join(',')} placeholder={t('civilDwg.field.stationsHint')}
                  onBlur={(e) => set({ stations: e.target.value.split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v) && e.target.value.trim() !== '') })} />
              </label>
              <Row label={t('civilDwg.field.columns')}><Cell label={t('civilDwg.field.columns')} value={d.columns ?? 3} min={1} onCommit={(columns) => set({ columns: Math.round(columns) })} /></Row>
              <Row label={t('civilDwg.field.halfWidth')}><Cell label={t('civilDwg.field.halfWidth')} value={d.halfWidth ?? 0} min={0} onCommit={(halfWidth) => set({ halfWidth })} /></Row>
            </>
          )}
        </Section>
        <Section title={t('civilDwg.zone.place')}>
          <p className="text-zinc-500">{t('civilDwg.placeSheet')}</p>
          <Button size="sm" variant="outline" onClick={() => drawCivilOnPlan(d.id)}>{t('civilDwg.drawOnPlan')}</Button>
          <p className="text-zinc-500">{t('civilDwg.placePlan')}</p>
        </Section>
        {layout ? <p className="text-zinc-500">{t('civilDwg.size', { w: Math.round(layout.width), h: Math.round(layout.height) })}</p> : null}
      </aside>
      <div className="min-w-0 flex-1 overflow-auto bg-zinc-100 p-4 dark:bg-zinc-900">
        {'error' in built ? <p role="alert" className="rounded-sm bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{built.error}</p> : null}
        {layout ? (
          <svg aria-hidden="true" className="h-full w-full bg-white" viewBox={`${-pad} ${-pad} ${layout.width + 2 * pad} ${layout.height + 2 * pad}`} preserveAspectRatio="xMidYMid meet">
            <CivilDrawingGraphic layout={layout} />
          </svg>
        ) : null}
      </div>
    </div>
  );
}
