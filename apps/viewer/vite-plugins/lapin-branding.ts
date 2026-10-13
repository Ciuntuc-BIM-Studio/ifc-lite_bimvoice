/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lapin's name and icons where the app cannot set them at run time: the page
 * title and the favicons in index.html, and the web app manifest
 * (`public/manifest.json`), in builds and on the dev server. The name comes
 * from `src/brand.ts`; the icons from `public/brand/lapin/`. index.html and
 * the manifest keep upstream ifc-lite's, so they merge cleanly.
 */

import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { APP_NAME } from '../src/brand';

const DESCRIPTION = 'BIM authoring tools on IFC-lite';

/** An inherited icon path → Lapin's (`/favicon-32x32-cropped.png` → `/brand/lapin/favicon-32.png`). */
export function lapinIcon(href: string): string {
  if (href === '/favicon.ico') return '/brand/lapin/favicon.ico';
  if (href === '/favicon.svg') return '/brand/lapin/favicon-512.png';
  if (href === '/apple-touch-icon.png') return '/brand/lapin/favicon-180.png';
  const sized = /^\/favicon-(\d+)x\d+-cropped\.png$/.exec(href);
  return sized ? `/brand/lapin/favicon-${sized[1]}.png` : href;
}

/** index.html with Lapin's title and icons. */
export function brandedHtml(html: string): string {
  const icon = (_m: string, a: string, href: string, b: string) => `${a}${lapinIcon(href)}${b}`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${APP_NAME}</title>`)
    .replace(/(<link rel="(?:shortcut )?icon"[^>]*?href=")([^"]+)(")/g, icon)
    .replace(/(<link rel="apple-touch-icon"[^>]*?href=")([^"]+)(")/g, icon)
    .replace(/(<meta name="msapplication-TileImage" content=")([^"]+)(")/g, icon)
    // The SVG favicon becomes a PNG: its type follows.
    .replace('type="image/svg+xml" href="/brand/lapin/favicon-512.png"', 'type="image/png" href="/brand/lapin/favicon-512.png"');
}

/** The web app manifest with Lapin's name, description and icons. */
export function brandedManifest(raw: string): string {
  const json = JSON.parse(raw) as { icons?: { src: string; type?: string }[] } & Record<string, unknown>;
  const icons = json.icons?.map((icon) => ({ ...icon, src: lapinIcon(icon.src), type: 'image/png' }));
  return `${JSON.stringify({ ...json, name: APP_NAME, short_name: APP_NAME, description: DESCRIPTION, icons }, null, 2)}\n`;
}

export function lapinBranding(publicDir: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'lapin-branding',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: brandedHtml,
    configureServer(server) {
      server.middlewares.use('/manifest.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(brandedManifest(fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8')));
      });
    },
    writeBundle() {
      const file = path.join(outDir, 'manifest.json');
      if (fs.existsSync(file)) fs.writeFileSync(file, brandedManifest(fs.readFileSync(file, 'utf8')));
    },
  };
}
