/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A project location on the globe: the latitude and longitude of the project
 * origin, and true north in the project's XY plane — grid north turned by the
 * project's rotation and by the meridian convergence at the site, found by
 * stepping north on the globe and projecting the step (any projection, no
 * per-projection formulae). Written to the IfcSite and the model context
 * (`setSiteGeolocationInStore`) after Project location is applied.
 */

import proj4 from 'proj4';
import { setSiteGeolocationInStore, type SiteGeolocation } from '@ifc-lite/create';
import type { ProjectedCRS } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { resolveProjection } from '@/lib/geo/reproject';
import type { LocationCrs } from './project-location-crs';
import type { LocationSolution } from './project-location';

/** Where the project origin of `solution` is on the globe, through the projection `projDef`; null when it does not project. */
export function geolocation(projDef: string, solution: LocationSolution): SiteGeolocation | null {
  const origin: [number, number] = [solution.eastings, solution.northings];
  const [lon, lat] = proj4(projDef, 'WGS84', origin);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [e, n] = proj4('WGS84', projDef, [lon, lat + 1e-4]);
  const dE = e - origin[0], dN = n - origin[1];
  if (!Number.isFinite(dE) || !Number.isFinite(dN) || Math.hypot(dE, dN) < 1e-9) return null;
  // Grid → project: undo the project's rotation θ.
  const c = solution.xAxisAbscissa, s = solution.xAxisOrdinate;
  return { latitude: lat, longitude: lon, elevation: solution.orthogonalHeight, trueNorth: [c * dE + s * dN, -s * dE + c * dN] };
}

/** Work out and write the site's position and true north on `models`; the number written (0 when the CRS cannot be resolved). */
export async function geolocateProject(models: readonly string[], crs: LocationCrs, solution: LocationSolution): Promise<number> {
  const projDef = await resolveProjection({ id: 0, name: crs.name, description: crs.description, mapZone: crs.mapZone } as ProjectedCRS).catch(() => null);
  const geo = projDef ? geolocation(projDef, solution) : null;
  if (!geo) return 0;
  let written = 0;
  for (const modelId of models) {
    try {
      recordModellingCommit(useViewerStore, modelId, (editor, ds) => setSiteGeolocationInStore(ds, editor, geo));
      written++;
    } catch (err) {
      console.warn('[project-location] could not write the site position', err);
    }
  }
  return written;
}
