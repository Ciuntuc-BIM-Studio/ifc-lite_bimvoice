/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Lapin's name and icons reach the page title, the favicons and the web app manifest (`vite-plugins/lapin-branding.ts`). */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { brandedHtml, brandedManifest } from '../../vite-plugins/lapin-branding';
import { APP_NAME } from '@/brand';

const root = path.resolve(import.meta.dirname, '../..');

describe('Lapin branding', () => {
  it('titles the page Lapin and points every favicon at Lapin\'s icons', () => {
    const html = brandedHtml(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
    assert.match(html, new RegExp(`<title>${APP_NAME}</title>`));
    assert.doesNotMatch(html, /<title>[^<]*IFClite/i);
    const icons = [...html.matchAll(/<link rel="(?:shortcut )?icon"[^>]*?href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(icons.length > 0);
    for (const href of icons) {
      assert.match(href, /^\/brand\/lapin\//, href);
      assert.ok(fs.existsSync(path.join(root, 'public', href)), `${href} exists`);
    }
    assert.doesNotMatch(html, /type="image\/svg\+xml" href="\/brand\/lapin/);
  });

  it('names the web app Lapin, with icons that exist', () => {
    const manifest = JSON.parse(brandedManifest(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8'))) as { name: string; short_name: string; icons: { src: string }[] };
    assert.equal(manifest.name, APP_NAME);
    assert.equal(manifest.short_name, APP_NAME);
    for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, 'public', icon.src)), `${icon.src} exists`);
  });
});
