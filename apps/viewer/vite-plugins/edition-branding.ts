/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The edition's product name (`src/edition.ts`: Lapin, IfcSheet) where the
 * app cannot read it at run time: the page title in index.html and the web
 * app manifest (`public/manifest.json`), in builds and on the dev server —
 * and, for Lapin, its own icons (`public/brand/lapin/`) in place of the
 * inherited favicons.
 */

import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { APP_NAMES, type Edition } from '../src/edition';

const DESCRIPTIONS: Record<Edition, string> = {
  full: 'BIM authoring tools on IFC-lite',
  docs: 'Drawings, sheets, annotations and schedules from IFC models',
};

/** An inherited icon path → Lapin's (`/favicon-32x32-cropped.png` → `/brand/lapin/favicon-32.png`). */
function lapinIcon(href: string): string {
  if (href === '/favicon.ico') return '/brand/lapin/favicon.ico';
  if (href === '/favicon.svg') return '/brand/lapin/favicon-512.png';
  if (href === '/apple-touch-icon.png') return '/brand/lapin/favicon-180.png';
  const sized = /^\/favicon-(\d+)x\d+-cropped\.png$/.exec(href);
  return sized ? `/brand/lapin/favicon-${sized[1]}.png` : href;
}

function manifest(raw: string, edition: Edition): string {
  const json = JSON.parse(raw) as { icons?: { src: string; type?: string }[] } & Record<string, unknown>;
  const icons = edition === 'full' ? json.icons?.map((icon) => ({ ...icon, src: lapinIcon(icon.src), type: 'image/png' })) : json.icons;
  return `${JSON.stringify({ ...json, name: APP_NAMES[edition], short_name: APP_NAMES[edition], description: DESCRIPTIONS[edition], icons }, null, 2)}\n`;
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
      const titled = html.replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`);
      if (edition !== 'full') return titled;
      return titled
        .replace(/(<link rel="(?:shortcut )?icon"[^>]*?href=")([^"]+)(")/g, (_m, a: string, href: string, b: string) => `${a}${lapinIcon(href)}${b}`)
        .replace(/(<link rel="apple-touch-icon"[^>]*?href=")([^"]+)(")/g, (_m, a: string, href: string, b: string) => `${a}${lapinIcon(href)}${b}`)
        .replace('type="image/svg+xml" href="/brand/lapin/favicon-512.png"', 'type="image/png" href="/brand/lapin/favicon-512.png"');
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
