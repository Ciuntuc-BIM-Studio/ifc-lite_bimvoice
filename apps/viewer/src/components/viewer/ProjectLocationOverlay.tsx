/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A georeferenced project's two reference points in the 3D view, beside the
 * models' origins (`BasepointOverlay`, the same toggle): the project base
 * point (±0.00) and the survey point Project location was set from, each
 * labelled with its surveyed coordinates.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { Pin, WorldLabel } from '@/components/viewport-ui/scene';
import { localToMap, type Vec3 } from '@/project/project-location';
import { projectToRender, readProjectLocation } from '@/project/project-location-store';
import { useProjectStore } from '@/project/project-store';

const BLUE = '#0063B1';
const fmt = (v: number) => v.toFixed(3);

export function ProjectLocationOverlay() {
  const { t } = useTranslation();
  const show = useViewerStore((s) => s.showModelBasepoints);
  const georef = useViewerStore((s) => s.georefMutations);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const surveyPoint = useProjectStore((s) => s.surveyPoint);
  const points = useMemo(() => {
    void georef; void mutationVersion;
    const location = show ? readProjectLocation() : null;
    if (!location?.conversion) return [];
    const { conversion, crs } = location;
    const label = ([e, n, h]: Vec3) => {
      const east = `${t(crs.xyLabels ? 'location.readout.y' : 'location.readout.e')} ${fmt(e)}`;
      const north = `${t(crs.xyLabels ? 'location.readout.x' : 'location.readout.n')} ${fmt(n)}`;
      return `${crs.northFirst ? `${north}  ${east}` : `${east}  ${north}`}  ${t('location.readout.h')} ${fmt(h)}`;
    };
    const out: { key: string; title: string; at: Vec3; text: string }[] = [];
    const base = projectToRender([0, 0, 0]);
    if (base) out.push({ key: 'base', title: t('location.marker.base'), at: base, text: label(localToMap(conversion, [0, 0, 0])) });
    if (surveyPoint && Math.hypot(...surveyPoint.local) > 1e-3) {
      const at = projectToRender(surveyPoint.local);
      if (at) out.push({ key: 'survey', title: t('location.marker.survey'), at, text: label(localToMap(conversion, surveyPoint.local)) });
    }
    return out;
  }, [show, georef, mutationVersion, surveyPoint, t]);

  return (
    <>
      {points.map((p) => (
        <LocationPin key={p.key} title={p.title} at={p.at} text={p.text} below={p.key === 'base'} />
      ))}
    </>
  );
}

/** `below`: the label under the pin (the base point shares its place with the model origin's pin and label). */
function LocationPin({ title, at, text, below }: { title: string; at: Vec3; text: string; below: boolean }) {
  const worldPoint = { x: at[0], y: at[1], z: at[2] };
  return (
    <>
      <Pin worldPoint={worldPoint} fill={BLUE} title={title} />
      <WorldLabel worldPoint={worldPoint} offset={{ dx: 14, dy: below ? 12 : -28 }}>
        <span className="font-mono" style={{ color: BLUE }}>{title}<br />{text}</span>
      </WorldLabel>
    </>
  );
}
