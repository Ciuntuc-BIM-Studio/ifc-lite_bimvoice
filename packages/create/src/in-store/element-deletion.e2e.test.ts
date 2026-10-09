/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Deleting elements of a real model takes their dependants: a wall its openings and windows, a window its opening; storeys are refused; the export keeps nothing of them. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deletionClosure } from './element-deletion.js';

const SAMPLE = fileURLToPath(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));

async function load() {
  const { IfcParser } = await import('@ifc-lite/parser');
  const { MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations');
  const source = readFileSync(SAMPLE);
  const store = await new IfcParser().parseColumnar(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  return { store, view, editor: new StoreEditor(store, view) };
}

describe.skipIf(!existsSync(SAMPLE))('element deletion closure', () => {
  it('takes a wall with its openings and windows, and the export keeps none of them', async () => {
    const { store, view, editor } = await load();
    const wall = (store.entityIndex.byType.get('IFCWALL') ?? [])[0];
    const plan = deletionClosure(store, [wall], view);
    const types = plan.ids.map((id) => store.entityIndex.byId.get(id)?.type ?? '').map((t) => t.toUpperCase());
    expect(plan.ids[0]).toBe(wall);
    expect(types.filter((t) => t === 'IFCOPENINGELEMENT')).toHaveLength(2);
    expect(types.filter((t) => t === 'IFCWINDOW')).toHaveLength(2);
    for (const id of plan.ids) editor.removeEntity(id);
    const { StepExporter } = await import('@ifc-lite/export');
    const text = new TextDecoder().decode(new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content);
    expect(text).not.toContain('IFCWINDOW(');
    expect(text).not.toContain('IFCOPENINGELEMENT(');
    expect(text).not.toContain('IFCRELVOIDSELEMENT(');
    expect(text).not.toContain('IFCRELFILLSELEMENT(');
    for (const id of plan.ids) expect(text).not.toMatch(new RegExp(`#${id}[,)]`));
  });

  it('takes a window with its opening (the wall closes) but not the wall, and refuses a storey', async () => {
    const { store, view } = await load();
    const window = (store.entityIndex.byType.get('IFCWINDOW') ?? [])[0];
    const plan = deletionClosure(store, [window], view);
    const types = plan.ids.map((id) => (store.entityIndex.byId.get(id)?.type ?? '').toUpperCase());
    expect(types).toEqual(['IFCWINDOW', 'IFCOPENINGELEMENT']);
    const storey = (store.entityIndex.byType.get('IFCBUILDINGSTOREY') ?? [])[0];
    const refused = deletionClosure(store, [storey], view);
    expect(refused.ids).toEqual([]);
    expect(refused.refused[0].id).toBe(storey);
  });
});
