/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A new file's IfcSite and IfcBuilding carry the caller's names and site
 * reference, and the file still parses with its storeys in place.
 */

import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { IfcCreator } from './ifc-creator.js';
import { compoundPlaneAngle } from './ifc-creator-spatial.js';

describe('IfcCreator site and building', () => {
  it('writes the configured site and building', async () => {
    const creator = new IfcCreator({
      Name: 'Casa Popescu',
      Site: { Name: 'Lot 12', Description: 'Str. Lalelelor 4', Latitude: 46.770439, Longitude: 23.591423, Elevation: 340 },
      Building: { Name: 'Corp A', LongName: 'Locuinta unifamiliala' },
    });
    creator.addIfcBuildingStorey({ Name: 'Parter', Elevation: 0 });
    creator.addIfcBuildingStorey({ Name: 'Etaj 1', Elevation: 3 });
    const { content } = creator.toIfc();
    expect(content).toMatch(/IFCSITE\('[^']+',#\d+,'Lot 12','Str\. Lalelelor 4',\$,#\d+,\$,\$,\.ELEMENT\.,\(46,46,13,580400\),\(23,35,29,122800\),340,\$,\$\)/);
    expect(content).toMatch(/IFCBUILDING\('[^']+',#\d+,'Corp A',\$,\$,#\d+,\$,'Locuinta unifamiliala',\.ELEMENT\.,\$,\$,\$\)/);
    const bytes = new TextEncoder().encode(content);
    const store = await new IfcParser().parseColumnar(bytes.buffer as ArrayBuffer, { disableWorkerScan: true });
    expect(store.spatialHierarchy?.byStorey.size).toBe(2);
  });

  it('keeps the defaults when nothing is configured', () => {
    const { content } = new IfcCreator().toIfc();
    expect(content).toMatch(/IFCSITE\('[^']+',#\d+,'Site',\$/);
    expect(content).toMatch(/IFCBUILDING\('[^']+',#\d+,'Building',\$/);
  });

  it('splits signed decimal degrees into a compound angle', () => {
    expect(compoundPlaneAngle(-0.5)).toEqual([0, -30, 0, 0]);
    expect(compoundPlaneAngle(10.25)).toEqual([10, 15, 0, 0]);
  });
});
