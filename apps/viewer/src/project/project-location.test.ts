/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localToMap, solveLocation, type LocationSolution, type Vec3 } from './project-location';
import { COUNTRIES, countryOf, crsFromStored, STEREO_70, surveyedEasting } from './project-location-crs';

const near = (a: readonly number[], b: readonly number[], tol = 1e-6) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tol, `${i}: ${v} ≠ ${b[i]}`));

describe('project location', () => {
  it('puts the base point at its surveyed coordinates, the project unturned', () => {
    const sol = solveLocation({ local: [0, 0, 0], map: [588_400.25, 326_700.5, 87.35] }, { kind: 'angle', degrees: 0 }) as LocationSolution;
    near([sol.eastings, sol.northings, sol.orthogonalHeight], [588_400.25, 326_700.5, 87.35]);
    near(localToMap(sol, [10, 5, 3]), [588_410.25, 326_705.5, 90.35]);
  });

  it('a point away from the origin, with a rotation: that point lands where the survey says', () => {
    const base = { local: [12, -4, 1.2] as Vec3, map: [500_000, 300_000, 90] as Vec3 };
    const sol = solveLocation(base, { kind: 'angle', degrees: 30 }) as LocationSolution;
    near(localToMap(sol, base.local), base.map);
    assert.ok(Math.abs(sol.rotation - 30) < 1e-9);
    near([sol.xAxisAbscissa, sol.xAxisOrdinate], [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]);
  });

  it('two surveyed points fix the rotation, and their misfit is reported, not absorbed', () => {
    // The project's X axis runs grid north: θ = 90°.
    const sol = solveLocation(
      { local: [0, 0, 0], map: [1000, 2000, 50] },
      { kind: 'point', point: { local: [10, 0, 0], map: [1000, 2010.004, 0] } },
    ) as LocationSolution;
    assert.ok(Math.abs(sol.rotation - 90) < 1e-6);
    near(localToMap(sol, [10, 0, 0]).slice(0, 2), [1000, 2010], 1e-6);
    assert.ok(Math.abs(sol.misfit! - 0.004) < 1e-9);
  });

  it('refuses two points at one place, and anything not a number', () => {
    assert.deepEqual(solveLocation({ local: [0, 0, 0], map: [1, 1, 0] }, { kind: 'point', point: { local: [0, 0, 0], map: [2, 2, 0] } }), { problem: 'samePoint' });
    assert.deepEqual(solveLocation({ local: [0, 0, 0], map: [Number.NaN, 1, 0] }, { kind: 'angle', degrees: 0 }), { problem: 'notFinite' });
  });

  it('knows Stereo 70 by its EPSG code, with its heights on the Black Sea datum', () => {
    assert.equal(crsFromStored('epsg:3844'), STEREO_70);
    assert.equal(STEREO_70.verticalDatum, 'EPSG:5781');
    assert.equal(crsFromStored('EPSG:32635').northFirst, false);
  });

  it('offers each country its zones and height datum, and tells Denmark from Germany by the heights', () => {
    const zones = (id: string) => COUNTRIES.find((c) => c.id === id)!.zones.map((z) => `${z.name} ${z.verticalDatum}`);
    assert.deepEqual(zones('es'), ['EPSG:25830 EPSG:5782', 'EPSG:25829 EPSG:5782', 'EPSG:25831 EPSG:5782']);
    assert.deepEqual(zones('at'), ['EPSG:31255 EPSG:5778', 'EPSG:31254 EPSG:5778', 'EPSG:31256 EPSG:5778']);
    assert.deepEqual(zones('dk'), ['EPSG:25832 EPSG:5799', 'EPSG:25833 EPSG:5799']);
    assert.deepEqual(zones('de'), ['EPSG:25832 EPSG:7837', 'EPSG:25833 EPSG:7837']);
    assert.deepEqual(countryOf({ name: 'EPSG:25832', verticalDatum: 'EPSG:5799' }), { country: 'dk', zone: 0 });
    assert.deepEqual(countryOf({ name: 'EPSG:25833', verticalDatum: 'EPSG:7837' }), { country: 'de', zone: 1 });
    assert.deepEqual(countryOf({ name: 'EPSG:2056' }), { country: 'other', zone: 0 });
    // Austria writes X (north) and Y (east), east first.
    assert.equal(crsFromStored('EPSG:31255').xyLabels, true);
    assert.equal(crsFromStored('EPSG:31255').northFirst, false);
  });

  it('takes the UTM zone off an easting written with it in front', () => {
    const zone32 = COUNTRIES.find((c) => c.id === 'de')!.zones[0];
    assert.equal(surveyedEasting(zone32, 32_389_000.25), 389_000.25);
    assert.equal(surveyedEasting(zone32, 389_000.25), 389_000.25);
    assert.equal(surveyedEasting(zone32, 33_389_000), 33_389_000, 'another zone stays as typed');
    assert.equal(surveyedEasting(STEREO_70, 32_389_000), 32_389_000);
  });
});

describe('project location on the globe', () => {
  const UTM_32N = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

  it('finds the origin and true north: east of the central meridian true north leans west of grid north', async () => {
    const { geolocation } = await import('./project-location-geo');
    // Near Berlin's longitude (13.4° E), 4.4° east of zone 32's meridian: about 3.4° of convergence.
    const sol = solveLocation({ local: [0, 0, 0], map: [797_000, 5_828_000, 35] }, { kind: 'angle', degrees: 0 }) as LocationSolution;
    const geo = geolocation(UTM_32N, sol)!;
    assert.ok(Math.abs(geo.latitude - 52.5) < 0.1 && Math.abs(geo.longitude - 13.4) < 0.2, `${geo.latitude}, ${geo.longitude}`);
    const lean = (Math.atan2(-geo.trueNorth[0], geo.trueNorth[1]) * 180) / Math.PI;
    assert.ok(lean > 3 && lean < 4, `true north ${lean}° west of grid north`);
    assert.equal(geo.elevation, 35);
    // Turn the project 90° (its X axis grid north): true north then lies along the project's X, leaning the same way.
    const turned = geolocation(UTM_32N, solveLocation({ local: [0, 0, 0], map: [797_000, 5_828_000, 35] }, { kind: 'angle', degrees: 90 }) as LocationSolution)!;
    assert.ok(turned.trueNorth[0] > 0.99 * Math.hypot(...turned.trueNorth));
    assert.ok(turned.trueNorth[1] > 0);
  });
});

describe('the survey point in the project file', () => {
  it('is saved and read back, and a malformed one is dropped', async () => {
    const { parseProjectFile, serializeProject } = await import('./project-file');
    const { EMPTY_PROJECT } = await import('./project-store');
    const surveyPoint = { local: [-2.268, 4.538, 0] as Vec3, map: [389_000.25, 5_800_000.5, 35.2] as Vec3 };
    assert.deepEqual(parseProjectFile(serializeProject({ ...EMPTY_PROJECT, surveyPoint })).surveyPoint, surveyPoint);
    const broken = JSON.parse(serializeProject(EMPTY_PROJECT));
    broken.surveyPoint = { local: [1, 2], map: [1, 2, 3] };
    assert.equal(parseProjectFile(JSON.stringify(broken)).surveyPoint, undefined);
  });
});
