/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A component's (or a bridge deck's, or an abutment's) own copy of its
 * profile, edited in place in the corridor configurator: a preset's parameters (or its points, dragged on the
 * drawing), then — if wanted — written back to the library profile it came
 * from, or saved there as a new one.
 */

import { useState } from 'react';
import type { StructureProfile } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import { structureProfiles, updateProfile } from '@/civil/profile-library';
import { ProfileCanvas } from './ProfileCanvas';
import { ShapeFields } from './ProfileFields';

interface Props {
  /** The library profile the copy came from. */
  profileId: string;
  profile: StructureProfile;
  onChange: (profileId: string, profile: StructureProfile) => void;
}

export function ComponentProfileEditor({ profileId, profile, onChange }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  const inLibrary = structureProfiles().some((p) => p.id === profileId);
  const set = (next: StructureProfile) => onChange(profileId, next);
  const toLibrary = () => {
    updateProfile({ ...structuredClone(profile), id: profileId });
    toast.success(t('civil.components.savedToLibrary', { name: profile.name }));
  };
  const toLibraryNew = () => {
    const id = freshProjectId('profile');
    const saved = { ...structuredClone(profile), id, name: `${profile.name} (2)` };
    useProjectStore.setState({ structureProfiles: [...structureProfiles(), saved], dirty: true });
    onChange(id, saved);
    toast.success(t('civil.components.savedToLibrary', { name: saved.name }));
  };
  return (
    <div className="space-y-1.5 border-t border-zinc-200 pt-1.5 dark:border-zinc-700">
      <ProfileCanvas profile={profile} width={270} height={190} onChange={set} active={active} onActive={setActive} />
      <ShapeFields profile={profile} onChange={set} active={active} onActive={setActive} />
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" disabled={!inLibrary} onClick={toLibrary}>{t('civil.components.toLibrary')}</Button>
        <Button size="sm" variant="ghost" onClick={toLibraryNew}>{t('civil.components.toLibraryNew')}</Button>
      </div>
    </div>
  );
}
