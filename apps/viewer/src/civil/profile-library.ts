/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's structure profile library (`@ifc-lite/create`'s
 * structure-profile), kept in the project file: add from a preset, copy,
 * change, remove, import / export a library file, and make a profile from a
 * closed contour drawn on any view (its inner closed shapes become holes).
 */

import { create } from 'zustand';
import { profileFromPreset, readProfileLibrary, starterProfiles, toCustomProfile, writeProfileLibrary, type P2, type PresetId, type StructureProfile } from '@ifc-lite/create';
import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import { contourLoops } from '@/drafting/commands/model';

export const structureProfiles = (): StructureProfile[] => useProjectStore.getState().structureProfiles ?? [];

export function structureProfile(id: string | null | undefined): StructureProfile | null {
  return id ? structureProfiles().find((p) => p.id === id) ?? null : null;
}

function save(list: StructureProfile[]): void {
  useProjectStore.setState({ structureProfiles: list, dirty: true });
}

/** A library with nothing in it gets the starter profiles (one per preset). */
export function ensureStarterProfiles(): void {
  if (structureProfiles().length === 0) save(starterProfiles().map((p) => ({ ...p, id: freshProjectId('profile') })));
}

export function addProfile(preset: PresetId): string {
  const p = profileFromPreset(preset, freshProjectId('profile'));
  save([...structureProfiles(), p]);
  return p.id;
}

export function duplicateProfile(id: string): string | null {
  const from = structureProfile(id);
  if (!from) return null;
  const copy = { ...structuredClone(from), id: freshProjectId('profile'), name: `${from.name} copy` };
  save([...structureProfiles(), copy]);
  return copy.id;
}

export function updateProfile(p: StructureProfile): void {
  save(structureProfiles().map((x) => (x.id === p.id ? p : x)));
}

export function removeProfile(id: string): void {
  save(structureProfiles().filter((p) => p.id !== id));
}

/** Import a library file; entries with an id already in the library replace it. Returns how many were read. */
export function importProfiles(text: string): number {
  const incoming = readProfileLibrary(text);
  const list = [...structureProfiles()];
  for (const p of incoming) {
    const at = list.findIndex((x) => x.id === p.id);
    if (at >= 0) list[at] = p;
    else list.push(p);
  }
  save(list);
  return incoming.length;
}

export function exportProfiles(): string {
  return writeProfileLibrary(structureProfiles());
}

/**
 * A custom profile from a closed drafted shape (drawing coordinates, metres):
 * its inner closed shapes are holes; the origin goes to the outline's lowest
 * point (leftmost of the lowest) — move it in the editor.
 */
export function profileFromDraft(draftId: string, name: string): { ok: true; id: string } | { ok: false; error: 'notClosed' } {
  const drafts = useProjectStore.getState().drafts;
  const source = drafts.find((d) => d.id === draftId);
  const loops = source ? contourLoops(source, drafts) : null;
  if (!loops || loops[0].length < 3) return { ok: false, error: 'notClosed' };
  const lowest = [...loops[0]].sort((a, b) => a.y - b.y || a.x - b.x)[0];
  const local = (pts: { x: number; y: number }[]): P2[] => pts.map((p) => [round(p.x - lowest.x), round(p.y - lowest.y)]);
  const base = profileFromPreset('gravity-wall', freshProjectId('profile'), name);
  const p: StructureProfile = { ...toCustomProfile(base), kind: 'custom', name, outer: local(loops[0]), holes: loops.slice(1).map(local), anchors: [], material: 'Concrete', color: '#a1a1aa', ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: name };
  save([...structureProfiles(), p]);
  return { ok: true, id: p.id };
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/** Move a profile's origin to `at` (profile coordinates): every point shifts by −at. */
export function moveOrigin(p: StructureProfile, at: P2): StructureProfile {
  const shift = (q: P2): P2 => [round(q[0] - at[0]), round(q[1] - at[1])];
  return { ...toCustomProfile(p), outer: p.outer.map(shift), holes: p.holes.map((h) => h.map(shift)), anchors: p.anchors.map((a) => ({ ...a, at: shift(a.at) })) };
}

/** Mirror (about the origin's vertical, x → −x) or flip (about its horizontal, y → −y) a profile's points for good. */
export function reflectProfile(p: StructureProfile, axis: 'x' | 'y'): StructureProfile {
  const r = (q: P2): P2 => (axis === 'x' ? [-q[0], q[1]] : [q[0], -q[1]]);
  // Reflection reverses a loop's turn: put the points back the way round they were.
  const loop = (l: P2[]) => l.map(r).reverse();
  return { ...toCustomProfile(p), outer: loop(p.outer), holes: p.holes.map(loop), anchors: p.anchors.map((a) => ({ ...a, at: r(a.at) })) };
}

export const useProfileDialog = create<{ open: boolean; selectedId: string | null }>()(() => ({ open: false, selectedId: null }));

export function openProfileLibrary(selectedId: string | null = null): void {
  ensureStarterProfiles();
  useProfileDialog.setState((s) => ({ open: true, selectedId: selectedId ?? s.selectedId ?? structureProfiles()[0]?.id ?? null }));
}

export function closeProfileLibrary(): void {
  useProfileDialog.setState({ open: false });
}
