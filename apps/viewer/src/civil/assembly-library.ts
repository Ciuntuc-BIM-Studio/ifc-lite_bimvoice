/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's typical cross-sections (assemblies): lanes, shoulder,
 * pavement courses and daylight slopes, saved under a name so a corridor
 * takes one in a click and a changed one goes back to the library. Kept in
 * the project file (`typicalSections`); a library with nothing in it gets
 * four common road sections.
 */

import type { AssemblySpec } from '@ifc-lite/create';
import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import type { ProjectTypicalSection } from '@/project/types';

const courses = (wearing: number, binder: number, base: number, subbase: number): AssemblySpec['layers'] => [
  { name: 'Wearing course', thickness: wearing, color: '#3a3a3a' },
  { name: 'Binder course', thickness: binder, color: '#4d4d4d' },
  { name: 'Base course', thickness: base, color: '#8a7f6a' },
  { name: 'Sub-base', thickness: subbase, color: '#b8ae9c' },
];

export function starterTypicalSections(): Omit<ProjectTypicalSection, 'id'>[] {
  return [
    { name: 'Two-lane road 2 × 3.50 m', assembly: { lanes: [{ width: 3.5, slope: -2.5 }], shoulder: { width: 1, slope: -4 }, layers: courses(0.04, 0.06, 0.2, 0.3), daylight: { cutSlope: 1, fillSlope: 1.5 }, nominalDepth: 1 } },
    { name: 'Four-lane road 2 × 2 × 3.50 m', assembly: { lanes: [{ width: 3.5, slope: -2.5 }, { width: 3.5, slope: -2.5 }], shoulder: { width: 2.5, slope: -4 }, layers: courses(0.05, 0.07, 0.25, 0.35), daylight: { cutSlope: 1, fillSlope: 2 }, nominalDepth: 1.5 } },
    { name: 'Access road 2 × 2.75 m', assembly: { lanes: [{ width: 2.75, slope: -2.5 }], shoulder: { width: 0.5, slope: -4 }, layers: courses(0.04, 0.05, 0.15, 0.25), daylight: { cutSlope: 1, fillSlope: 1.5 }, nominalDepth: 0.8 } },
    { name: 'Single-lane track 4.00 m', assembly: { lanes: [{ width: 2, slope: -3 }], shoulder: null, layers: [{ name: 'Gravel', thickness: 0.2, color: '#a8a29e' }, { name: 'Sub-base', thickness: 0.25, color: '#b8ae9c' }], daylight: { cutSlope: 1, fillSlope: 1.5 }, nominalDepth: 0.6 } },
  ];
}

export const typicalSections = (): ProjectTypicalSection[] => useProjectStore.getState().typicalSections ?? [];

function save(list: ProjectTypicalSection[]): void {
  useProjectStore.setState({ typicalSections: list, dirty: true });
}

export function ensureStarterTypicalSections(): void {
  if (typicalSections().length === 0) save(starterTypicalSections().map((t) => ({ ...t, id: freshProjectId('typical') })));
}

/** Save an assembly as a new typical section; returns its id. */
export function addTypicalSection(name: string, assembly: AssemblySpec): string {
  const id = freshProjectId('typical');
  save([...typicalSections(), { id, name, assembly: structuredClone(assembly) }]);
  return id;
}

export function updateTypicalSection(id: string, assembly: AssemblySpec): void {
  save(typicalSections().map((t) => (t.id === id ? { ...t, assembly: structuredClone(assembly) } : t)));
}

export function removeTypicalSection(id: string): void {
  save(typicalSections().filter((t) => t.id !== id));
}

/** The library entry an assembly matches exactly, if any. */
export function matchingTypicalSection(assembly: AssemblySpec): ProjectTypicalSection | null {
  const key = JSON.stringify(assembly);
  return typicalSections().find((t) => JSON.stringify(t.assembly) === key) ?? null;
}
