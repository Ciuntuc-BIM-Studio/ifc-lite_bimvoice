/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The edition's product name (`src/edition.ts`: Lapin, IfcSheet) where the
 * app cannot read it at run time: the page title in index.html and the web
 * app manifest (`public/manifest.json`), in builds and on the dev server.
 */

import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { APP_NAMES, type Edition } from '../src/edition';

const DESCRIPTIONS: Record<Edition, string> = {
  full: 'BIM modelling and documentation for IFC models',
  docs: 'Drawings, sheets, annotations and schedules from IFC models',
};

function manifest(raw: string, edition: Edition): string {
  const json = JSON.parse(raw) as Record<string, unknown>;
  return `${JSON.stringify({ ...json, name: APP_NAMES[edition], short_name: APP_NAMES[edition], description: DESCRIPTIONS[edition] }, null, 2)}\n`;
}

export function editionBranding(edition: Edition, publicDir: string): Plugin {
  const name = APP_NAMES[edition];
  let outDir = 'dist';
  return {
    name: 'edition-branding',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      return html.replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`);
    },
    configureServer(server) {
      server.middlewares.use('/manifest.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest(fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8'), edition));
      });
    },
    writeBundle() {
      const file = path.join(outDir, 'manifest.json');
      if (fs.existsSync(file)) fs.writeFileSync(file, manifest(fs.readFileSync(file, 'utf8'), edition));
    },
  };
}
