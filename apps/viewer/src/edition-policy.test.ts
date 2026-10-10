/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The two editions: the full edition offers everything; the docs edition
 * keeps documentation (views, sheets, drafting, annotations, schedules,
 * property edits) and refuses modelling wherever it is reached from.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { can, edition, setEditionForTests } from './edition.js';
import { draftCommandAllowed, keyCommandAllowed, modellingDenial, panelAllowed, ribbonTabAllowed, surfaceCommandAllowed } from './edition-policy.js';
import { DRAFT_COMMANDS, draftCommandById, draftCommandByName } from './drafting/commands/registry.js';
import { useViewerStore } from './store/index.js';
import { modelChangeDenial } from './store/mutation-permission.js';

afterEach(() => setEditionForTests(null));

describe('editions', () => {
  it('builds the full edition by default, offering everything', () => {
    assert.equal(edition(), 'full');
    assert.ok(can('modelling') && can('infrastructure') && can('analysis') && can('propertyEditing'));
    assert.ok(ribbonTabAllowed('model') && panelAllowed('extensions') && surfaceCommandAllowed('tool:wall'));
    assert.ok(DRAFT_COMMANDS.every((c) => draftCommandAllowed(c.id)));
    assert.ok(keyCommandAllowed('selection.delete'));
    assert.equal(modellingDenial(), null);
  });

  it('docs keeps documentation tabs, panels and commands', () => {
    setEditionForTests('docs');
    for (const tab of ['file', 'home', 'view', 'annotations']) assert.ok(ribbonTabAllowed(tab), tab);
    for (const panel of ['properties', 'lists', 'drawing', 'document']) assert.ok(panelAllowed(panel), panel);
    for (const id of ['design:joinery', 'file:save', 'panel:properties']) assert.ok(surfaceCommandAllowed(id), id);
    for (const id of ['line', 'dimlinear', 'text', 'hatch', 'tag', 'sectionline', 'level']) assert.ok(draftCommandById(id), id);
    assert.ok(can('propertyEditing'));
  });

  it('docs leaves out modelling, infrastructure and analysis', () => {
    setEditionForTests('docs');
    assert.ok(!can('modelling') && !can('infrastructure') && !can('analysis'));
    assert.ok(!ribbonTabAllowed('model'));
    for (const panel of ['extensions', 'appearance', 'changeSets', 'sources']) assert.ok(!panelAllowed(panel), panel);
    for (const id of ['tool:wall', 'tool:door', 'design:bim-wall', 'design:roof-system', 'infra:road', 'context:delete', 'panel:extensions', 'extensions:run', 'file:new-project']) {
      assert.ok(!surfaceCommandAllowed(id), id);
    }
    for (const id of ['extrude', 'roof', 'road', 'bridge', 'civildwg', 'placedoor', 'placewindow', 'placeopening']) {
      assert.equal(draftCommandById(id), undefined, id);
    }
    assert.equal(draftCommandByName('roof'), undefined);
    for (const id of ['selection.delete', 'edit.duplicate', 'model.wall']) assert.ok(!keyCommandAllowed(id), id);
    assert.ok(keyCommandAllowed('visibility.hideSelection'));
    assert.match(modellingDenial() ?? '', /properties can be edited/);
  });

  it('docs refuses structural edits in the store, whatever surface asks', () => {
    setEditionForTests('docs');
    const s = useViewerStore.getState();
    assert.equal(s.removeEntity('any-model', 1), false);
    assert.match(modelChangeDenial(s, 'any-model') ?? '', /properties can be edited/);
    assert.equal(s.enterModelWorkspace(), false);
    const before = useViewerStore.getState().activeTool;
    s.setActiveTool('command');
    assert.equal(useViewerStore.getState().activeTool, before);
  });
});
