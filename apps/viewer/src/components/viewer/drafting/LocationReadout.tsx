/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A floor plan of a georeferenced project: the project base point (±0.00,
 * a circle with a cross) and the survey point (the known point Project
 * location was set from, a triangle), and the cursor's surveyed
 * coordinates in the bottom corner: X / Y as Romania and Austria write them,
 * easting / northing elsewhere, in the order surveys there give them, and
 * the plan's level as a height above the vertical datum.
 *
 * The plan → project mapping is affine (a level's plan is flat), so it is
 * taken once from three points and applied to every cursor move.
 */

import { useMemo } from 'react';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { localToMap, type Vec3 } from '@/project/project-location';
import { planPointToProject, projectToRender, readProjectLocation } from '@/project/project-location-store';
import { useProjectStore } from '@/project/project-store';
import { drawingToScreen, worldToDrawing, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import type { ProjectView } from '@/project/types';

const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/,/g, ' ');

interface Props {
  view: ProjectView;
  plane: SectionPlaneConfig | undefined;
  cursor: Pt | null;
  transform: ViewTransform;
  axis: SectionAxisName;
}

const BLUE = '#0063B1';

/** The base point's and survey point's places on the plan's drawing (the survey point only where it is not the base point). */
function useMarkers(view: ProjectView, plane: SectionPlaneConfig | undefined, located: boolean): { base: Pt | null; survey: Pt | null } {
  const surveyPoint = useProjectStore((s) => s.surveyPoint);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  return useMemo(() => {
    void mutationVersion;
    if (!plane || view.kind !== 'plan' || !located) return { base: null, survey: null };
    const onPlan = (p: Vec3): Pt | null => {
      const r = projectToRender(p);
      return r ? worldToDrawing(plane, { x: r[0], y: r[1], z: r[2] }) : null;
    };
    const apart = surveyPoint && Math.hypot(...surveyPoint.local) > 1e-3;
    return { base: onPlan([0, 0, 0]), survey: apart ? onPlan(surveyPoint.local) : null };
  }, [view, plane, located, surveyPoint, mutationVersion]);
}

export function LocationReadout({ view, plane, cursor, transform, axis }: Props) {
  const { t } = useTranslation();
  const georef = useViewerStore((s) => s.georefMutations);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const location = useMemo(() => {
    void georef; void mutationVersion;
    return readProjectLocation();
  }, [georef, mutationVersion]);
  const toProject = useMemo(() => {
    void mutationVersion;
    if (!plane || view.kind !== 'plan' || !location?.conversion) return null;
    const o = planPointToProject(view, plane, { x: 0, y: 0 });
    const u = planPointToProject(view, plane, { x: 1, y: 0 });
    const v = planPointToProject(view, plane, { x: 0, y: 1 });
    if (!o || !u || !v) return null;
    return (p: Pt): Vec3 => [0, 1, 2].map((k) => o[k] + (u[k] - o[k]) * p.x + (v[k] - o[k]) * p.y) as Vec3;
  }, [view, plane, location, mutationVersion]);
  const markers = useMarkers(view, plane, !!location?.conversion);
  const base = markers.base ? drawingToScreen(markers.base, transform, axis) : null;
  const survey = markers.survey ? drawingToScreen(markers.survey, transform, axis) : null;
  const symbols = (base || survey) && (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {base && (
        <g stroke={BLUE} strokeWidth={1.5} fill="none">
          <circle cx={base.x} cy={base.y} r={8} fill="#ffffff" fillOpacity={0.7} />
          <path d={`M${base.x - 5.5} ${base.y - 5.5}L${base.x + 5.5} ${base.y + 5.5}M${base.x + 5.5} ${base.y - 5.5}L${base.x - 5.5} ${base.y + 5.5}`} />
          <text x={base.x + 11} y={base.y + 14} fill={BLUE} stroke="none" fontSize={10} fontFamily="monospace">{t('location.marker.base')}</text>
        </g>
      )}
      {survey && (
        <g stroke={BLUE} strokeWidth={1.5} fill="none">
          <path d={`M${survey.x} ${survey.y - 9}L${survey.x + 8} ${survey.y + 5}L${survey.x - 8} ${survey.y + 5}Z`} fill="#ffffff" fillOpacity={0.7} />
          <path d={`M${survey.x - 3} ${survey.y + 1}H${survey.x + 3}M${survey.x} ${survey.y - 2}V${survey.y + 4}`} />
          <text x={survey.x + 11} y={survey.y + 14} fill={BLUE} stroke="none" fontSize={10} fontFamily="monospace">{t('location.marker.survey')}</text>
        </g>
      )}
    </svg>
  );
  if (!cursor || !toProject || !location?.conversion) return symbols || null;

  const [e, n, h] = localToMap(location.conversion, toProject(cursor));
  const { xyLabels, northFirst } = location.crs;
  const east = `${t(xyLabels ? 'location.readout.y' : 'location.readout.e')} ${fmt(e)}`;
  const north = `${t(xyLabels ? 'location.readout.x' : 'location.readout.n')} ${fmt(n)}`;
  return (
    <>
      {symbols}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/85 px-2 py-0.5 font-mono text-2xs text-zinc-700 shadow-sm dark:bg-zinc-900/85 dark:text-zinc-300">
        {northFirst ? `${north}  ${east}` : `${east}  ${north}`}  {t('location.readout.h')} {fmt(h)}
        <span className="ml-2 text-zinc-400">{location.crs.name}</span>
      </div>
    </>
  );
}
