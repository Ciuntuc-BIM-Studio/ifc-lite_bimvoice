/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The geographic side of a georeferenced project, kept in line with its
 * IfcMapConversion: the IfcSite's RefLatitude / RefLongitude / RefElevation
 * (where the project origin is on the globe and how high), and the model
 * context's TrueNorth (true north as a direction in the project's XY plane,
 * which differs from grid north by the rotation and the meridian
 * convergence). The caller works these out from the projection; this writes
 * them, inside the caller's transaction.
 */

import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from './resolve-anchor.js';

export interface SiteGeolocation {
  /** Degrees, WGS 84. */
  latitude: number;
  longitude: number;
  /** The project origin's height above the vertical datum, metres. */
  elevation: number;
  /** True north in the project's XY plane (unit, or any length). */
  trueNorth: [number, number];
}

/**
 * An angle as IfcCompoundPlaneAngleMeasure: degrees, minutes, seconds and
 * millionths of a second, every part carrying the angle's sign.
 */
export function compoundAngle(degrees: number): [number, number, number, number] {
  const sign = degrees < 0 ? -1 : 1;
  let micro = Math.round(Math.abs(degrees) * 3600 * 1e6);
  const d = Math.floor(micro / 3600e6); micro -= d * 3600e6;
  const m = Math.floor(micro / 60e6); micro -= m * 60e6;
  const s = Math.floor(micro / 1e6); micro -= s * 1e6;
  // `+ 0` turns a negative zero into zero, which STEP writes as 0.
  return [sign * d + 0, sign * m + 0, sign * s + 0, sign * micro + 0];
}

/** Write `geo` to every IfcSite and the root model context. The ids written. */
export function setSiteGeolocationInStore(store: IfcDataStore, editor: StoreEditor, geo: SiteGeolocation): number[] {
  const view: MutablePropertyView = editor.getMutationView();
  const r = new AnchorEntityReader(store, view);
  const written: number[] = [];
  for (const site of r.ids('IFCSITE')) {
    editor.setPositionalAttribute(site, 9, compoundAngle(geo.latitude));
    editor.setPositionalAttribute(site, 10, compoundAngle(geo.longitude));
    editor.setPositionalAttribute(site, 11, { real: geo.elevation });
    written.push(site);
  }
  const context = r.rootContextId();
  const len = Math.hypot(geo.trueNorth[0], geo.trueNorth[1]);
  if (context !== null && len > 1e-12) {
    const direction = editor.addEntity('IfcDirection', [[{ real: geo.trueNorth[0] / len }, { real: geo.trueNorth[1] / len }]]).expressId;
    editor.setPositionalAttribute(context, 5, `#${direction}`);
    written.push(context);
  }
  return written;
}
