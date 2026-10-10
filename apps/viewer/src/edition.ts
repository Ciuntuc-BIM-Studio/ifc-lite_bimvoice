/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The app's two editions, chosen at build time (`VITE_EDITION`, folded into
 * the `__EDITION__` constant so the bundler drops what an edition leaves
 * out):
 *   - `full` — everything, BIM modelling included (the default, local);
 *   - `docs` — documentation from existing IFC files: views, sheets, 2D
 *     drafting and annotations, exports, schedules and reports, and editing
 *     of properties; the model's geometry and structure are never changed,
 *     and analysis tools (IDS, BCF, clashes, charts, scripts, extensions,
 *     assistant) are left out.
 */

declare const __EDITION__: 'full' | 'docs' | undefined;

export type Edition = 'full' | 'docs';

/** The edition this bundle was built as (a constant: branches on it are folded at build time). */
export const BUILD_EDITION: Edition = typeof __EDITION__ === 'string' && __EDITION__ === 'docs' ? 'docs' : 'full';

let override: Edition | null = null;

/** The running edition (tests may switch it). */
export function edition(): Edition {
  return override ?? BUILD_EDITION;
}

export const isDocsEdition = (): boolean => edition() === 'docs';

/** What each edition can do. */
export const capabilities = {
  /** Creating, deleting, moving, retyping model elements; BIM tools; configurators applied to the model. */
  modelling: (): boolean => !isDocsEdition(),
  /** Road and bridge modelling. */
  infrastructure: (): boolean => !isDocsEdition(),
  /** IDS, BCF, clashes, charts and dashboards, scripts and flows, extensions, the assistant. */
  analysis: (): boolean => !isDocsEdition(),
  /** Properties and attributes of IFC elements (marks, codes, property sets) — both editions. */
  propertyEditing: (): boolean => true,
} as const;

export type Capability = keyof typeof capabilities;

export const can = (capability: Capability): boolean => capabilities[capability]();

/** For tests only: run as another edition (null restores the built one). */
export function setEditionForTests(next: Edition | null): void {
  override = next;
}
