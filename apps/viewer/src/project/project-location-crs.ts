/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The coordinate systems Project location offers, by country: each the
 * projected CRS surveys there are delivered in, its zones, the national
 * height datum, and how the coordinates are written (which comes first,
 * and whether they are called X / Y or easting / northing). Anything else
 * is entered by its EPSG code.
 *
 * - Romania: Stereo 70, heights Black Sea 1975 (Constanța).
 * - Spain: ETRS89 / UTM 29N, 30N, 31N, heights Alicante (the Peninsula).
 * - Austria: MGI / Austria GK West, Central, East, heights GHA (Adriatic).
 * - Denmark: ETRS89 / UTM 32N (33N for Bornholm), heights DVR90.
 * - Germany: ETRS89 / UTM 32N, 33N, heights DHHN2016.
 */

/** A projected CRS as IfcProjectedCRS writes it, and how its coordinates are written. */
export interface LocationCrs {
  /** IfcProjectedCRS.Name: the EPSG code ('EPSG:3844'). */
  name: string;
  description?: string;
  geodeticDatum?: string;
  /** The heights' datum, by its EPSG code ('EPSG:5781'). */
  verticalDatum?: string;
  mapProjection?: string;
  mapZone?: string;
  /** Surveys give the north coordinate first. */
  northFirst: boolean;
  /** The coordinates are called X (north) and Y (east), as in Romania and Austria. */
  xyLabels: boolean;
  /** UTM: the zone, which German surveys often write in front of the easting (32 389 000.00). */
  utmZone?: number;
}

export type CountryId = 'ro' | 'es' | 'at' | 'dk' | 'de' | 'other';

export interface CountryCrs {
  id: CountryId;
  /** The zones (one for a country with one); the first is the usual one. */
  zones: readonly LocationCrs[];
}

const utm = (zone: number, height: string): LocationCrs => ({
  name: `EPSG:${25800 + zone}`,
  description: `ETRS89 / UTM zone ${zone}N`,
  geodeticDatum: 'ETRS89',
  verticalDatum: height,
  mapProjection: 'Transverse Mercator',
  mapZone: `${zone}N`,
  northFirst: false,
  xyLabels: false,
  utmZone: zone,
});

const gk = (code: number, zone: string): LocationCrs => ({
  name: `EPSG:${code}`,
  description: `MGI / Austria GK ${zone}`,
  geodeticDatum: 'MGI',
  verticalDatum: 'EPSG:5778',
  mapProjection: 'Transverse Mercator',
  mapZone: `GK ${zone}`,
  northFirst: false,
  xyLabels: true,
});

/** Romania's national grid and heights. */
export const STEREO_70: LocationCrs = {
  name: 'EPSG:3844',
  description: 'Pulkovo 1942(58) / Stereo70',
  geodeticDatum: 'Pulkovo 1942(58)',
  verticalDatum: 'EPSG:5781',
  mapProjection: 'Oblique Stereographic',
  northFirst: true,
  xyLabels: true,
};

export const COUNTRIES: readonly CountryCrs[] = [
  { id: 'ro', zones: [STEREO_70] },
  // Alicante heights (EPSG:5782): the Peninsula; the islands have their own.
  { id: 'es', zones: [utm(30, 'EPSG:5782'), utm(29, 'EPSG:5782'), utm(31, 'EPSG:5782')] },
  { id: 'at', zones: [gk(31255, 'Central'), gk(31254, 'West'), gk(31256, 'East')] },
  { id: 'dk', zones: [utm(32, 'EPSG:5799'), utm(33, 'EPSG:5799')] },
  { id: 'de', zones: [utm(32, 'EPSG:7837'), utm(33, 'EPSG:7837')] },
];

/** A CRS entered by its code: easting first, no zone. */
export const customCrs = (name: string, verticalDatum?: string): LocationCrs => ({ name, ...(verticalDatum ? { verticalDatum } : {}), northFirst: false, xyLabels: false });

/** The country and zone a CRS is, by its name and height datum ('other' when none offers it). */
export function countryOf(crs: Pick<LocationCrs, 'name' | 'verticalDatum'>): { country: CountryId; zone: number } {
  const name = crs.name.trim().toUpperCase();
  for (const c of COUNTRIES) {
    // UTM 32N is offered by Denmark and Germany: the height datum tells them apart.
    const zone = c.zones.findIndex((z) => z.name === name && (!crs.verticalDatum || z.verticalDatum === crs.verticalDatum));
    if (zone >= 0) return { country: c.id, zone };
  }
  return { country: 'other', zone: 0 };
}

/** The CRS a stored IfcProjectedCRS is: the offered one it matches, else a custom one carrying it. */
export function crsFromStored(name: string | undefined, verticalDatum?: string): LocationCrs {
  if (!name) return STEREO_70;
  const { country, zone } = countryOf({ name, verticalDatum });
  return country === 'other' ? customCrs(name.trim().toUpperCase(), verticalDatum) : COUNTRIES.find((c) => c.id === country)!.zones[zone];
}

/** An easting as typed: with the UTM zone written in front (32 389 000.00 in zone 32), the zone comes off. */
export function surveyedEasting(crs: Pick<LocationCrs, 'utmZone'>, easting: number): number {
  if (crs.utmZone === undefined || !(easting >= 1e7)) return easting;
  const zone = Math.floor(easting / 1e6);
  return zone === crs.utmZone ? easting - zone * 1e6 : easting;
}
