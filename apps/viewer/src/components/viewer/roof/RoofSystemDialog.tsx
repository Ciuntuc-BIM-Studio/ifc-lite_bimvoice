/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The roof configurator, on one roof system: the architecture zone (edges,
 * covering) and the structure zone side by side, the plan and 3D previews
 * live, Apply regenerating the block in the model (one undo step). From here
 * the roof is edited in place, its structure regenerated or deleted.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  readRoofSystem, roofGeometry, roofProblem, roofStructure, roofSystemParts, type RoofGeometry, type RoofMember, type RoofSystemSpec,
} from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { applyRoofSystem } from '@/project/roof-system-element';
import { deleteRoofWithConfirm } from './delete-roof';
import { closeRoofDialog, startRoofEdit, useRoofDialog } from '@/project/roof-dialog-store';
import { ArchitectureFields, StructureFields } from './RoofFields';
import { RoofIsoPreview, RoofPlanPreview } from './RoofPreview';

function readSpec(modelId: string, roofId: number): RoofSystemSpec | null {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  return dataStore ? readRoofSystem(dataStore, roofId, s.mutationViews.get(modelId) ?? null) : null;
}

export function RoofSystemDialog() {
  const { t } = useTranslation();
  const target = useRoofDialog((s) => s.open);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const saved = useMemo(() => (target ? readSpec(target.modelId, target.roofId) : null), [target, mutationVersion]);
  const [draft, setDraft] = useState<RoofSystemSpec | null>(null);
  const [edge, setEdge] = useState<number | null>(null);
  useEffect(() => { setDraft(saved ? structuredClone(saved) : null); }, [saved]);

  const problem = draft ? roofProblem(draft.outline, draft.rules) : null;
  const built = useMemo((): { g: RoofGeometry; members: RoofMember[] } | { error: string } | null => {
    if (!draft || problem) return null;
    try {
      const g = roofGeometry(draft.outline, draft.rules);
      return { g, members: roofStructure(g, draft.structure) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [draft, problem]);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const apply = (spec: RoofSystemSpec | null = draft) => {
    if (!target || !spec) return;
    const result = applyRoofSystem(target, spec);
    if (result.ok) toast.success(t('roof.applied'));
    else toast.error(t('roof.problem', { reason: result.error }));
  };
  const editInPlace = () => {
    if (!target || !saved) return;
    if (dirty) apply();
    const s = useViewerStore.getState();
    const dataStore = s.models.get(target.modelId)?.ifcDataStore;
    const parts = dataStore ? roofSystemParts(dataStore, target.roofId, s.mutationViews.get(target.modelId) ?? null) : [];
    startRoofEdit({ ...target, spec: saved }, parts);
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) closeRoofDialog(); }}>
      <DialogContent className="sm:max-w-[1200px] max-h-[92vh] overflow-hidden">
        <DialogHeader><DialogTitle>{t('roof.title', { name: draft?.name ?? '' })}</DialogTitle></DialogHeader>
        {draft ? (
          <div className="grid h-[68vh] grid-cols-[23rem_19rem_1fr] gap-3 text-xs">
            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              <ArchitectureFields spec={draft} onChange={setDraft} edge={edge} onEdge={setEdge} />
            </div>
            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              <StructureFields spec={draft} onChange={setDraft} />
            </div>
            <div className="min-h-0 space-y-2 overflow-y-auto">
              {problem || (built && 'error' in built) ? (
                <p role="alert" className="rounded-sm bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">
                  {t('roof.problem', { reason: problem ?? (built && 'error' in built ? built.error : '') ?? '' })}
                </p>
              ) : null}
              {built && 'g' in built ? (
                <>
                  <RoofPlanPreview g={built.g} edge={edge} onEdge={setEdge} width={420} height={300} label={t('roof.preview.plan')} />
                  <RoofIsoPreview g={built.g} members={built.members} color={draft.covering.color} timber={draft.timberColor} width={420} height={260} label={t('roof.preview.model')} />
                  <p className="text-zinc-500">{t('roof.summary', { planes: built.g.planes.length, members: built.members.length })}</p>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!saved} onClick={editInPlace}>{t('roof.editInPlace')}</Button>
            <Button size="sm" variant="ghost" disabled={!saved} onClick={() => apply(saved)}>{t('roof.regenerateStructure')}</Button>
            <Button size="sm" variant="ghost" disabled={!draft || draft.structure.system === 'none'}
              onClick={() => { if (draft) { const next = { ...draft, structure: { ...draft.structure, system: 'none' as const } }; setDraft(next); apply(next); } }}>
              {t('roof.deleteStructure')}
            </Button>
            <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={!saved || !target}
              onClick={() => { if (target && saved) void deleteRoofWithConfirm({ ...target, spec: saved }); }}>
              {t('roof.delete')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => saved && setDraft(structuredClone(saved))}>{t('roof.revert')}</Button>
            <Button size="sm" disabled={!dirty || !!problem || !built || 'error' in built} onClick={() => apply()}>{t('roof.apply')}</Button>
            <Button size="sm" variant="outline" onClick={closeRoofDialog}>{t('roof.close')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
