/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Overlay styled items become style wire entries: item → its surface colour, through IFC4 and IFC2X3 chains. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overlayStyleWire, withOverlayStyles } from './overlay-style-wire';

const entity = (expressId: number, type: string, attributes: unknown[]) => ({ expressId, type, attributes });

describe('overlay style wire', () => {
  it('follows styled items to their surface colour and transparency', () => {
    const all = [
      entity(10, 'IfcColourRgb', [null, { real: 1 }, { real: 0.5 }, { real: 0 }]),
      entity(11, 'IfcSurfaceStyleShading', ['#10', { real: 0.25 }]),
      entity(12, 'IfcSurfaceStyle', ['Roof', '.BOTH.', ['#11']]),
      entity(13, 'IfcStyledItem', ['#100', ['#12'], null]),
      // IFC2X3: through a presentation style assignment.
      entity(20, 'IfcPresentationStyleAssignment', [['#12']]),
      entity(21, 'IfcStyledItem', ['#200', ['#20'], null]),
      // No colour behind it: left out.
      entity(22, 'IfcStyledItem', ['#300', ['#999'], null]),
    ];
    const byId = new Map(all.map((e) => [e.expressId, e.attributes]));
    const wire = overlayStyleWire({ entities: () => all, attributes: (id) => byId.get(id) ?? null });
    assert.deepEqual([...wire.styleIds], [100, 200]);
    assert.deepEqual([...wire.styleColors], [255, 128, 0, 191, 255, 128, 0, 191]);
    const merged = withOverlayStyles({ styleIds: Uint32Array.of(5), styleColors: Uint8Array.of(1, 2, 3, 4) }, wire);
    assert.deepEqual([...merged.styleIds], [5, 100, 200]);
    assert.equal(merged.styleColors.length, 12);
  });
});
