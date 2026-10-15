/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The cursor's surveyed coordinates in a floor plan of a georeferenced
 * project, in the bottom corner: X / Y as Romania and Austria write them,
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
import { planPointToProject, readProjectLocation } from '@/project/project-location-store';
import type { Pt } from '@/drafting/types';
import type { ProjectView } from '@/project/types';

const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/,/g, ' ');

interface Props {
  view: ProjectView;
  plane: SectionPlaneConfig | undefined;
  cursor: Pt | null;
}

export function LocationReadout({ view, plane, cursor }: Props) {
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
  if (!cursor || !toProject || !location?.conversion) return null;

  const [e, n, h] = localToMap(location.conversion, toProject(cursor));
  const { xyLabels, northFirst } = location.crs;
  const east = `${t(xyLabels ? 'location.readout.y' : 'location.readout.e')} ${fmt(e)}`;
  const north = `${t(xyLabels ? 'location.readout.x' : 'location.readout.n')} ${fmt(n)}`;
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/85 px-2 py-0.5 font-mono text-2xs text-zinc-700 shadow-sm dark:bg-zinc-900/85 dark:text-zinc-300">
      {northFirst ? `${north}  ${east}` : `${east}  ${north}`}  {t('location.readout.h')} {fmt(h)}
      <span className="ml-2 text-zinc-400">{location.crs.name}</span>
    </div>
  );
}
