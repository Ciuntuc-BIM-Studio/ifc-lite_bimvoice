/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The docs edition's bundle check (`src/edition.ts`): a docs build fails if
 * any module the docs edition leaves out — modelling tools, infrastructure,
 * analysis and extensions — reached the output, so "not offered" also means
 * "not shipped" (`EDITION_CHECK=warn` reports without failing). `EDITION_REPORT=<file>` writes every chunk's modules and
 * sizes there (to see what a build carries).
 */

import fs from 'fs';
import type { Plugin } from 'vite';

/** Source paths (relative to apps/viewer/src, or package dirs) the docs edition must not ship. */
export const DOCS_EXCLUDED: readonly RegExp[] = [
  // Infrastructure modelling: corridors, bridges, assemblies, profiles and their editors
  // (road drawings and corridors already made still display: civil-drawings, civil-plan, corridor-element,
  // CivilDrawingView / CivilDrawingGraphic stay).
  /\/apps\/viewer\/src\/civil\/(corridor-dialog-store|landxml-exchange|assembly-library|civil-drawing-actions)\.ts$/,
  /\/src\/components\/viewer\/civil\/(Assembly|Bridge|Component|CorridorDialog|CorridorPreview|Profile(Fields|LibraryDialog|Canvas)|TypicalSectionBar|delete-corridor)/,
  // Model-workspace tools (wall, slab, stair, push-pull, split, align…) and their overlays.
  /\/src\/lib\/commands\/modeling\/commands\//,
  /\/src\/components\/viewer\/tools\/command\//,
  // Drafting commands that build model elements (doors / windows, roofs, roads, bridges, solids).
  /\/src\/drafting\/commands\/(hosted|roof|road|solids|civil-drawing)\.ts$/,
  // Roof system editing (roofs already modelled still draw on plans: RoofPlanLayer stays).
  /\/src\/components\/viewer\/roof\/(RoofBlockCards|RoofEditBar|RoofFields|RoofOutlineGrips|RoofPreview|RoofSystemDialog|RoofTypeControls|delete-roof)/,
  // Element types and materials editors.
  /\/src\/components\/viewer\/element-types\//,
  /\/src\/components\/viewer\/materials\//,
  // Analysis workflows, and the extensions' panel and docks (the shared extension services stay).
  /\/src\/components\/viewer\/flow\//,
  /\/src\/components\/extensions\/(ExtensionsPanel|ExtensionDockHost|ExtensionKeyboardBindings)\.tsx$/,
];

const excludedId = (id: string) => DOCS_EXCLUDED.some((rule) => rule.test(id.replaceAll('\\', '/')));

/**
 * The docs build's tree-shaking: an excluded module is kept only for what is
 * used from it, never for its top-level code alone (a command object or a
 * store it builds on load). Other modules keep the default.
 */
export function docsModuleSideEffects(id: string): boolean {
  return !excludedId(id);
}

export function editionBundle(edition: 'full' | 'docs'): Plugin {
  return {
    name: 'bimvoice-edition-bundle',
    apply: 'build',
    generateBundle(_options, bundle) {
      const report: { chunk: string; bytes: number; modules: { id: string; bytes: number; exports: string[] }[] }[] = [];
      const shipped = new Set<string>();
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        const modules = Object.entries(out.modules).map(([id, m]) => ({ id, bytes: m.renderedLength, exports: m.renderedExports }));
        for (const m of modules) if (m.bytes > 0) shipped.add(m.id);
        report.push({ chunk: out.fileName, bytes: out.code.length, modules: modules.sort((a, b) => b.bytes - a.bytes) });
      }
      const file = process.env.EDITION_REPORT;
      if (file) fs.writeFileSync(file, JSON.stringify(report.sort((a, b) => b.bytes - a.bytes), null, 1));
      if (edition !== 'docs') return;
      const leaked = [...shipped].filter(excludedId);
      if (file && leaked.length) {
        // Where the excluded code is reached from: shared modules importing it (the edges to cut).
        const excluded = new Set(leaked);
        const edges: Record<string, string[]> = {};
        for (const id of leaked) {
          const info = this.getModuleInfo(id);
          const from = [...(info?.importers ?? []), ...(info?.dynamicImporters ?? [])].filter((i) => !excluded.has(i) && shipped.has(i));
          for (const i of from) (edges[i] ??= []).push(id);
        }
        fs.writeFileSync(`${file}.edges.json`, JSON.stringify(edges, null, 1));
      }
      if (leaked.length) {
        // EDITION_CHECK=warn: report and still write the output (to inspect a build).
        const report = process.env.EDITION_CHECK === 'warn' ? this.warn.bind(this) : this.error.bind(this);
        report(`The docs edition bundle carries ${leaked.length} module(s) it must leave out:\n  ${leaked.slice(0, 40).join('\n  ')}${leaked.length > 40 ? '\n  …' : ''}`);
      }
    },
  };
}
