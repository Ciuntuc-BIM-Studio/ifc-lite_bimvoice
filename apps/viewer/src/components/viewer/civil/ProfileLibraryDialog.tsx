/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The structure profile library: the project's profiles on the left (new
 * from a preset, copy, delete, import / export a library file), the
 * selected one's fields in the middle, its drawing on the right — dragged
 * point by point when it is a custom outline. Edits stay a draft until Save.
 */

import { useEffect, useState } from 'react';
import { Copy, Download, Trash2, Upload } from 'lucide-react';
import { PRESET_IDS, profileArea, profileBounds, structureProfileProblem, type PresetId, type StructureProfile } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { downloadFile } from '@/lib/export/download';
import { useProjectStore } from '@/project/project-store';
import {
  addProfile, closeProfileLibrary, duplicateProfile, exportProfiles, importProfiles, removeProfile, updateProfile, useProfileDialog,
} from '@/civil/profile-library';
import { ProfileCanvas } from './ProfileCanvas';
import { AnchorFields, IdentityFields, ShapeFields } from './ProfileFields';
import { INPUT } from '../joinery/JoineryFields';

export function ProfileLibraryDialog() {
  const { t } = useTranslation();
  const open = useProfileDialog((s) => s.open);
  const selectedId = useProfileDialog((s) => s.selectedId);
  const profiles = useProjectStore((s) => s.structureProfiles) ?? [];
  const saved = profiles.find((p) => p.id === selectedId) ?? null;
  const [draft, setDraft] = useState<StructureProfile | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [preset, setPreset] = useState<PresetId>('cantilever-wall');
  useEffect(() => { setDraft(saved ? structuredClone(saved) : null); setActive(null); }, [selectedId, saved]);

  const select = (id: string | null) => useProfileDialog.setState({ selectedId: id });
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const problem = draft ? structureProfileProblem(draft) : null;
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        toast.success(t('profiles.imported', { count: importProfiles(await file.text()) }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    };
    input.click();
  };
  const size = (p: StructureProfile) => {
    const b = profileBounds(p);
    return t('profiles.size', { w: (b.maxX - b.minX).toFixed(2), h: (b.maxY - b.minY).toFixed(2) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeProfileLibrary(); }}>
      <DialogContent className="sm:max-w-[1120px] max-h-[92vh] overflow-hidden">
        <DialogHeader><DialogTitle>{t('profiles.title')}</DialogTitle></DialogHeader>
        <div className="grid h-[66vh] grid-cols-[14rem_22rem_1fr] gap-3 text-xs">
          <aside className="flex min-h-0 flex-col gap-2">
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label={t('profiles.title')}>
              {profiles.length === 0 ? <li className="p-2 text-zinc-500">{t('profiles.empty')}</li> : profiles.map((p) => (
                <li key={p.id}>
                  <button type="button" aria-current={p.id === selectedId} aria-label={p.name}
                    className={`flex w-full items-center gap-2 rounded-md border p-1.5 text-left ${p.id === selectedId ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    onClick={() => select(p.id)}>
                    <span className="size-3 shrink-0 rounded-sm border border-zinc-400" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="text-zinc-500">{t(`profiles.kind.${p.kind}`)} · {size(p)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-[1fr_auto] gap-1">
              <select aria-label={t('profiles.preset')} className={INPUT} value={preset} onChange={(e) => setPreset(e.target.value as PresetId)}>
                {PRESET_IDS.map((id) => <option key={id} value={id}>{t(`profiles.preset.${id}`)}</option>)}
              </select>
              <Button size="sm" variant="outline" onClick={() => select(addProfile(preset))}>{t('profiles.new')}</Button>
              <Button size="sm" variant="ghost" onClick={importFile}><Upload className="mr-1 size-3.5" />{t('profiles.import')}</Button>
              <Button size="sm" variant="ghost" disabled={profiles.length === 0} onClick={() => downloadFile(exportProfiles(), 'structure-profiles.json', 'application/json')}>
                <Download className="mr-1 size-3.5" />{t('profiles.export')}
              </Button>
            </div>
          </aside>
          {draft && saved ? (
            <>
              <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate text-sm font-semibold">{draft.name}</span>
                  <IconButton label={t('profiles.duplicate')} className="size-7" onClick={() => select(duplicateProfile(saved.id))}><Copy className="size-3.5" /></IconButton>
                  <IconButton label={t('profiles.delete', { name: saved.name })} className="size-7" onClick={() => { removeProfile(saved.id); select(null); }}><Trash2 className="size-3.5" /></IconButton>
                </div>
                <IdentityFields profile={draft} onChange={setDraft} />
                <ShapeFields profile={draft} onChange={setDraft} active={active} onActive={setActive} />
                <AnchorFields profile={draft} onChange={setDraft} />
              </div>
              <div className="min-h-0 space-y-2 overflow-y-auto">
                <ProfileCanvas profile={draft} width={460} height={380} onChange={setDraft} active={active} onActive={setActive} caption={size(draft)} />
                {problem ? <p role="alert" className="rounded-sm bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{problem}</p> : null}
                <p className="text-zinc-500">{t('profiles.summary', { size: size(draft), area: profileArea(draft).toFixed(3), points: draft.outer.length })}</p>
                <p className="text-zinc-500">{t(draft.preset ? 'profiles.hint.preset' : 'profiles.hint.custom')}</p>
              </div>
            </>
          ) : <p className="col-span-2 self-center text-center text-zinc-500">{t('profiles.empty')}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => saved && setDraft(structuredClone(saved))}>{t('profiles.revert')}</Button>
          <Button size="sm" disabled={!dirty || !!problem} onClick={() => { if (draft) { updateProfile(draft); toast.success(t('profiles.saved', { name: draft.name })); } }}>{t('profiles.save')}</Button>
          <Button size="sm" variant="outline" onClick={closeProfileLibrary}>{t('profiles.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
