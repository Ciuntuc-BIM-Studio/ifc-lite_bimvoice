/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Joinery schedules as project items: create, change their settings. */

import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import type { ProjectSchedule } from '@/project/types';

export function addSchedule(kind: ProjectSchedule['kind'], name: string): string {
  const id = freshProjectId('schedule');
  const schedules = useProjectStore.getState().schedules ?? [];
  useProjectStore.setState({ schedules: [...schedules, { id, name, kind, createdAt: Date.now(), scale: 50 }], dirty: true });
  return id;
}

export function updateSchedule(id: string, patch: Partial<Omit<ProjectSchedule, 'id' | 'createdAt'>>): void {
  const schedules = useProjectStore.getState().schedules ?? [];
  useProjectStore.setState({ schedules: schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)), dirty: true });
}

export function scheduleById(id: string): ProjectSchedule | undefined {
  return (useProjectStore.getState().schedules ?? []).find((s) => s.id === id);
}
