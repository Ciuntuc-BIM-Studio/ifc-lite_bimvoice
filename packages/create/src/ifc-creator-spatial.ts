/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * STEP argument lists of the IfcSite and IfcBuilding a new file starts
 * with, from the caller's names, descriptions and site reference
 * (latitude / longitude in decimal degrees, elevation in file units).
 */

import { esc } from './ifc-creator-math.js';
import type { BuildingParams, SiteParams } from './types.js';

const text = (value: string | undefined): string => (value ? `'${esc(value)}'` : '$');

/**
 * Decimal degrees as an IfcCompoundPlaneAngleMeasure: degrees, minutes,
 * seconds and millionths of a second, all carrying the sign.
 */
export function compoundPlaneAngle(decimalDegrees: number): number[] {
  const sign = decimalDegrees < 0 ? -1 : 1;
  let rest = Math.abs(decimalDegrees);
  const deg = Math.floor(rest);
  rest = (rest - deg) * 60;
  const min = Math.floor(rest);
  rest = (rest - min) * 60;
  const sec = Math.floor(rest);
  const micro = Math.round((rest - sec) * 1e6);
  return [deg, min, sec, micro].map((v) => (v === 0 ? 0 : v * sign));
}

function angle(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '$' : `(${compoundPlaneAngle(value).join(',')})`;
}

export function siteArgs(globalId: string, ownerHistoryId: number, placementId: number, site: SiteParams = {}): string {
  const elevation = site.Elevation !== undefined && Number.isFinite(site.Elevation) ? `${site.Elevation}` : '$';
  return `'${globalId}',#${ownerHistoryId},'${esc(site.Name ?? 'Site')}',${text(site.Description)},$,#${placementId},$,${text(site.LongName)},.ELEMENT.,${angle(site.Latitude)},${angle(site.Longitude)},${elevation},$,$`;
}

export function buildingArgs(globalId: string, ownerHistoryId: number, placementId: number, building: BuildingParams = {}): string {
  return `'${globalId}',#${ownerHistoryId},'${esc(building.Name ?? 'Building')}',${text(building.Description)},$,#${placementId},$,${text(building.LongName)},.ELEMENT.,$,$,$`;
}
