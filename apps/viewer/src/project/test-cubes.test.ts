/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { boxQuantities, testCubesIfc } from './test-cubes';

describe('test cubes', () => {
  it('measures a box', () => {
    assert.deepEqual(boxQuantities(1, 2, 3), { footprint: 2, surface: 22, volume: 6 });
  });

  it('writes every box as a proxy with its own GlobalId, a shared shape per size and the quantities of that size', async () => {
    const text = await (await testCubesIfc(500)).text();
    const proxies = [...text.matchAll(/IFCBUILDINGELEMENTPROXY\('([^']+)'/g)].map((m) => m[1]);
    assert.equal(proxies.length, 500);
    const guids = [...text.matchAll(/^#\d+=IFC\w+\('([0-9A-Za-z_$]{22})'/gm)].map((m) => m[1]);
    assert.equal(new Set(guids).size, guids.length);

    const lines = new Map([...text.matchAll(/^#(\d+)=(.*);$/gm)].map((m) => [Number(m[1]), m[2]]));
    const contained = /IFCRELCONTAINEDINSPATIALSTRUCTURE\('[^']+',\$,\$,\$,\(([^)]*)\),#17\)/.exec(text);
    assert.equal(contained![1].split(',').length, 500);
    // Each size: its profile and depth agree with its quantity set, which is assigned to its boxes.
    for (const m of text.matchAll(/^#(\d+)=IFCRECTANGLEPROFILEDEF\(\.AREA\.,\$,#21,([\d.]+),([\d.]+)\);$/gm)) {
      const id = Number(m[1]);
      const [x, y] = [Number(m[2]), Number(m[3])];
      const z = Number(/,([\d.]+)\)$/.exec(lines.get(id + 1)!)![1]);
      const q = boxQuantities(x, y, z);
      assert.ok(lines.get(id + 4)!.includes(`'FootprintArea',$,#8,${Number(q.footprint.toFixed(6))}`));
      assert.ok(Math.abs(Number(/,([\d.]+),\$\)$/.exec(lines.get(id + 6)!)![1]) - q.volume) < 1e-6);
      assert.ok(lines.get(id + 7)!.includes("'Qto_BuildingElementProxyQuantities'"));
      const rel = lines.get(id + 8)!;
      assert.match(rel, new RegExp(`^IFCRELDEFINESBYPROPERTIES\\(.*,#${id + 7}\\)$`));
      for (const member of /\(([^()]*)\),#\d+\)$/.exec(rel)![1].split(',')) {
        assert.ok(lines.get(Number(member.slice(1)))!.includes(`,#${id + 3},$,.NOTDEFINED.)`));
      }
    }
    assert.equal(text.trimEnd().endsWith('END-ISO-10303-21;'), true);
  });
});
