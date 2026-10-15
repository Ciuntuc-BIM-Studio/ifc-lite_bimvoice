/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where the project sits on the map: the IFC4X3 IfcMapConversion that takes
 * the project's own coordinates (the engineering CRS, metres, Z up) to a
 * projected CRS, solved from what a designer has in hand — a point of the
 * model and its surveyed coordinates, and either the rotation or a second
 * surveyed point.
 *
 *   E = Eastings  + x·cos θ − y·sin θ
 *   N = Northings + x·sin θ + y·cos θ
 *   H = OrthogonalHeight + z
 *
 * with XAxisAbscissa = cos θ and XAxisOrdinate = sin θ (θ anticlockwise from
 * grid east to the project's X axis). The scale stays 1: a second point
 * whose surveyed distance differs from the model's is reported, not
 * absorbed. The model is never moved; only the conversion says where it is.
 */

export type Vec3 = [number, number, number];

/** A point of the model (project coordinates) and where the survey puts it (E, N, H). */
export interface SurveyedPoint {
  local: Vec3;
  map: Vec3;
}

export type LocationRotation =
  | { kind: 'angle'; degrees: number }
  /** A second point fixes the rotation; its height is not used. */
  | { kind: 'point'; point: SurveyedPoint };

export interface LocationSolution {
  eastings: number;
  northings: number;
  orthogonalHeight: number;
  /** θ, degrees, anticlockwise from grid east to the project's X axis. */
  rotation: number;
  xAxisAbscissa: number;
  xAxisOrdinate: number;
  /** Two points: surveyed distance minus the model's (metres); the survey and the model disagree by this much. */
  misfit?: number;
}

export type LocationProblem = 'samePoint' | 'notFinite';

const finite = (v: readonly number[]) => v.every(Number.isFinite);

/** Solve the conversion; a problem when the input cannot fix it. */
export function solveLocation(base: SurveyedPoint, rotation: LocationRotation): LocationSolution | { problem: LocationProblem } {
  if (!finite([...base.local, ...base.map])) return { problem: 'notFinite' };
  let theta: number;
  let misfit: number | undefined;
  if (rotation.kind === 'angle') {
    if (!Number.isFinite(rotation.degrees)) return { problem: 'notFinite' };
    theta = (rotation.degrees * Math.PI) / 180;
  } else {
    const { local, map } = rotation.point;
    if (!finite([...local, ...map])) return { problem: 'notFinite' };
    const dx = local[0] - base.local[0], dy = local[1] - base.local[1];
    const dE = map[0] - base.map[0], dN = map[1] - base.map[1];
    const model = Math.hypot(dx, dy), survey = Math.hypot(dE, dN);
    if (model < 1e-6 || survey < 1e-6) return { problem: 'samePoint' };
    theta = Math.atan2(dN, dE) - Math.atan2(dy, dx);
    misfit = survey - model;
  }
  const c = Math.cos(theta), s = Math.sin(theta);
  const [x, y, z] = base.local;
  const degrees = (((theta * 180) / Math.PI) % 360 + 540) % 360 - 180;
  return {
    eastings: base.map[0] - (x * c - y * s),
    northings: base.map[1] - (x * s + y * c),
    orthogonalHeight: base.map[2] - z,
    rotation: degrees,
    xAxisAbscissa: c,
    xAxisOrdinate: s,
    ...(misfit === undefined ? {} : { misfit }),
  };
}

/** The conversion as IfcMapConversion stores it (what `solveLocation` returns, or one read from a model). */
export type MapConversionFields = Pick<LocationSolution, 'eastings' | 'northings' | 'orthogonalHeight'> & { xAxisAbscissa?: number; xAxisOrdinate?: number };

/** Project coordinates → map (E, N, H). */
export function localToMap(conversion: MapConversionFields, p: Vec3): Vec3 {
  const len = Math.hypot(conversion.xAxisAbscissa ?? 1, conversion.xAxisOrdinate ?? 0) || 1;
  const c = (conversion.xAxisAbscissa ?? 1) / len, s = (conversion.xAxisOrdinate ?? 0) / len;
  return [conversion.eastings + p[0] * c - p[1] * s, conversion.northings + p[0] * s + p[1] * c, conversion.orthogonalHeight + p[2]];
}

/** The rotation of a stored conversion, degrees. */
export function conversionRotation(conversion: MapConversionFields): number {
  return (Math.atan2(conversion.xAxisOrdinate ?? 0, conversion.xAxisAbscissa ?? 1) * 180) / Math.PI;
}
