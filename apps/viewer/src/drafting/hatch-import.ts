/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Loading `.pat` hatch patterns into the project. The patterns are the
 * user's own files, kept in the project document (and its sidecar file),
 * never shipped with the app; a pattern with a built-in's name overrides it.
 */

import { resolve } from '@/i18n/registry';
import { toast } from '@/components/ui/toast';
import { useProjectStore } from '@/project/project-store';
import { parsePat, serializePat, type HatchPattern } from './hatch/pattern';

/** Merge `incoming` into the project's patterns (same name: the new one wins). Returns how many were added or replaced. */
export function addProjectHatchPatterns(incoming: readonly HatchPattern[]): number {
  if (incoming.length === 0) return 0;
  const state = useProjectStore.getState();
  const existing = parsePat(state.hatchPatterns ?? '').patterns;
  const names = new Set(incoming.map((p) => p.name.toUpperCase()));
  const merged = [...existing.filter((p) => !names.has(p.name.toUpperCase())), ...incoming];
  useProjectStore.setState({ hatchPatterns: serializePat(merged), dirty: true });
  return incoming.length;
}

/** Ask for a `.pat` file and add its patterns to the project. */
export function importHatchPatternFile(): Promise<void> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pat,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        done();
        return;
      }
      const { patterns, errors } = parsePat(await file.text());
      if (patterns.length === 0) {
        toast.error(resolve('drafting.msg.patNone', { detail: errors[0] ?? file.name }));
      } else {
        const count = addProjectHatchPatterns(patterns);
        toast.success(resolve('drafting.msg.patLoaded', { count, skipped: errors.length }));
      }
      done();
    };
    input.click();
  });
}
