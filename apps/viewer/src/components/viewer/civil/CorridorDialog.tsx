/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The corridor configurator, on one corridor: the corridor, alignment and
 * profile tables on the left, the assembly in the middle, the plan /
 * profile / section previews on the right (live, from the draft), Apply
 * regenerating the block in the model (one undo step). From here the
 * corridor is exported to LandXML or deleted.
 */

import { useEffect, useMemo, useState } from 'react';
import { alignmentProblem, buildCorridor, profileProblem, requiredSuperelevation, Terrain, type CorridorModel, type CorridorSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { applyCorridor, listTerrains, readCorridorSpec, terrainTin } from '@/civil/corridor-element';
import { closeCorridorDialog, useCorridorDialog } from '@/civil/corridor-dialog-store';
import { exportCorridorLandXml } from '@/civil/landxml-exchange';
import { deleteCorridorWithConfirm } from './delete-corridor';
import { AlignmentFields, GeneralFields, ProfileFields } from './CorridorFields';
import { AssemblyFields } from './AssemblyFields';
import { PlanPreview, ProfilePreview, SectionPreview } from './CorridorPreview';

export function CorridorDialog() {
  const { t } = useTranslation();
  const target = useCorridorDialog((s) => s.open);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const saved = useMemo(() => (target ? readCorridorSpec(target.modelId, target.corridorId) : null), [target, mutationVersion]);
  const storeyId = useMemo(() => (target ? useViewerStore.getState().models.get(target.modelId)?.ifcDataStore?.spatialHierarchy?.elementToStorey.get(target.corridorId) ?? null : null), [target, mutationVersion]);
  const terrains = useMemo(() => (target ? listTerrains(target.modelId) : []), [target, mutationVersion]);
  const [draft, setDraft] = useState<CorridorSpec | null>(null);
  const [station, setStation] = useState(0);
  useEffect(() => { setDraft(saved ? structuredClone(saved) : null); }, [saved]);

  const terrain = useMemo(() => (target && storeyId !== null && draft ? terrainTin(target.modelId, storeyId, draft.terrainGlobalId) : null), [target, storeyId, draft?.terrainGlobalId, mutationVersion]);
  const problem = draft ? alignmentProblem(draft.alignment) ?? profileProblem(draft.profile) : null;
  const built = useMemo((): CorridorModel | { error: string } | null => {
    if (!draft || problem) return null;
    try {
      return buildCorridor(draft, terrain ? new Terrain(terrain) : null);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [draft, problem, terrain]);
  const model = built && 'stations' in built ? built : null;
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const maxE = model ? Math.max(0, ...model.alignment.segments.filter((s) => s.kind === 'arc').map((s) => requiredSuperelevation(s.radius, draft!.design))) : 0;

  const apply = () => {
    if (!target || !draft) return;
    const result = applyCorridor(target, draft);
    if (result.ok) toast.success(t('civil.applied', { cut: Math.round(result.volumes.cut), fill: Math.round(result.volumes.fill) }));
    else toast.error(t('civil.problem', { reason: result.error }));
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) closeCorridorDialog(); }}>
      <DialogContent className="sm:max-w-[1240px] max-h-[92vh] overflow-hidden">
        <DialogHeader><DialogTitle>{t('civil.title', { name: draft?.name ?? '' })}</DialogTitle></DialogHeader>
        {draft ? (
          <div className="grid h-[70vh] grid-cols-[25rem_19rem_1fr] gap-3 text-xs">
            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              <GeneralFields spec={draft} onChange={setDraft} terrains={terrains} />
              <AlignmentFields spec={draft} onChange={setDraft} />
              <ProfileFields spec={draft} onChange={setDraft} terrain={terrain} />
            </div>
            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              <AssemblyFields spec={draft} onChange={setDraft} />
              <p className="text-zinc-500">{t('civil.hint.schema')}</p>
            </div>
            <div className="min-h-0 space-y-2 overflow-y-auto">
              {problem || (built && 'error' in built) ? (
                <p role="alert" className="rounded-sm bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">
                  {t('civil.problem', { reason: problem ?? (built && 'error' in built ? built.error : '') ?? '' })}
                </p>
              ) : null}
              {model ? (
                <>
                  <PlanPreview model={model} width={440} height={240} label={t('civil.preview.plan')} station={station} />
                  <ProfilePreview model={model} terrain={terrain} width={440} height={140} label={t('civil.preview.profile')} station={station} />
                  <label className="flex items-center gap-2">
                    <span className="text-zinc-500">{t('civil.preview.station')}</span>
                    <input type="range" className="flex-1" min={model.alignment.startStation} max={model.alignment.endStation} step={1} value={Math.min(Math.max(station, model.alignment.startStation), model.alignment.endStation)}
                      onChange={(e) => setStation(Number(e.target.value))} aria-label={t('civil.preview.station')} />
                  </label>
                  <SectionPreview model={model} terrain={terrain} width={440} height={180} label={t('civil.preview.section')} station={station} layers={draft.assembly.layers}
                    caption={(st, left, right) => t('civil.preview.sectionCaption', { station: st, left, right })} />
                  <p className="text-zinc-500">
                    {t('civil.summary', { length: Math.round(model.alignment.length), stations: model.stations.length, cut: Math.round(model.volumes.cut), fill: Math.round(model.volumes.fill), e: maxE })}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!saved || !target} onClick={() => { if (target && saved) exportCorridorLandXml({ ...target, spec: saved }); }}>{t('civil.export')}</Button>
            <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={!saved || !target}
              onClick={() => { if (target && saved) void deleteCorridorWithConfirm({ ...target, spec: saved }); }}>
              {t('civil.delete')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => saved && setDraft(structuredClone(saved))}>{t('civil.revert')}</Button>
            <Button size="sm" disabled={!dirty || !!problem || !model} onClick={apply}>{t('civil.apply')}</Button>
            <Button size="sm" variant="outline" onClick={closeCorridorDialog}>{t('civil.close')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
