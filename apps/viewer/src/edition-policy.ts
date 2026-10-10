/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the running edition (`edition.ts`) offers, in one place: ribbon tabs,
 * workspace panels, surface commands (ribbon, palette, context menu),
 * drafting commands and keyboard commands. The full edition offers
 * everything; the docs edition keeps documentation — views, sheets, 2D
 * drafting and annotations, exports, schedules and reports, properties —
 * and leaves out modelling, infrastructure and analysis tools.
 */

import { isDocsEdition } from './edition';

/** Ribbon tabs the docs edition shows (Design keeps its drafting groups only). */
const DOCS_TABS = new Set(['file', 'home', 'view', 'elements', 'author', 'design', 'annotations', 'analyze']);

/** Workspace panels of the docs edition: documentation and the element's data. */
const DOCS_PANELS = new Set(['hierarchy', 'properties', 'lists', 'drawing', 'measurements', 'document', 'presentation', 'changes']);

/** Surface commands the docs edition leaves out, by exact id or by prefix (ending in ':' or '-'). */
const DOCS_DENIED_COMMANDS = [
  // BIM tools and model edits on the Design tab.
  'design:bim-', 'design:flip-', 'design:element-types', 'design:materials', 'design:roof-system', 'design:join-', 'design:cut-priorities',
  'design:group', 'design:ungroup', 'design:move-to-storey', 'design:extrude', 'design:sweep', 'design:revolve', 'design:workplane-face',
  // Road and bridge modelling.
  'infra:',
  // Modelling tools of the model workspace.
  'tool:wall', 'tool:slab', 'tool:column', 'tool:beam', 'tool:room', 'tool:space-envelope', 'tool:curtain-wall', 'tool:grid', 'tool:opening',
  'tool:door', 'tool:window', 'tool:split', 'tool:stair', 'tool:railing', 'tool:push-pull', 'tool:align', 'tool:trim-extend', 'model:reposition',
  // Element edits from the context menu.
  'context:duplicate', 'context:flip-', 'context:delete',
  // Authoring that writes geometry or appearance, and the extension system.
  'panel:appearance', 'panel:changeSets', 'panel:extensions', 'extensions:',
  // A blank model is for modelling.
  'file:new-project',
];

const deniedCommand = (id: string) => DOCS_DENIED_COMMANDS.some((rule) => id === rule || ((rule.endsWith(':') || rule.endsWith('-')) && id.startsWith(rule)) || id.startsWith(`${rule}-`));

/** Drafting commands that build or change IFC elements (the rest only draft and annotate). */
const MODELLING_DRAFT_COMMANDS = new Set(['extrude', 'sweep', 'revolve', 'roof', 'road', 'bridge', 'placedoor', 'placewindow', 'placeopening', 'civildwg']);

/** Keyboard commands that change the model's geometry or structure. */
const MODELLING_KEYS = /^(model\.|command\.element\.)|^(edit\.rotate|edit\.duplicate|tool\.split|selection\.delete)$/;

export function ribbonTabAllowed(id: string): boolean {
  return !isDocsEdition() || DOCS_TABS.has(id);
}

export function panelAllowed(id: string): boolean {
  return !isDocsEdition() || DOCS_PANELS.has(id);
}

export function surfaceCommandAllowed(id: string): boolean {
  if (!isDocsEdition()) return true;
  if (id.startsWith('panel:')) return panelAllowed(id.slice('panel:'.length)) && !deniedCommand(id);
  return !deniedCommand(id);
}

export function draftCommandAllowed(id: string): boolean {
  return !isDocsEdition() || !MODELLING_DRAFT_COMMANDS.has(id);
}

export function keyCommandAllowed(id: string): boolean {
  return !isDocsEdition() || !MODELLING_KEYS.test(id);
}

/** Why the model may not be changed structurally in this edition, or null when it may. */
export function modellingDenial(): string | null {
  return isDocsEdition() ? 'This edition documents existing models: their elements are not created, deleted, moved or retyped (properties can be edited)' : null;
}
