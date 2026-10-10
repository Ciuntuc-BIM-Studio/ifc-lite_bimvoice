/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The door and window configurator: the project's catalogue on the left,
 * the selected type's fields in the middle, its drawings live on the right.
 * Edits stay a draft until Save, which updates the catalogue and every
 * element of that type already placed (`pushJoinery`). From here a type is
 * made the one the Door / Window tool places, or applied to the selection.
 */

import { can } from '@/edition';
import { useEffect, useMemo, useState } from 'react';
import { setOpeningConvention, useOpeningConvention } from '@/joinery/opening-convention';
import type { OpeningConvention } from '@/joinery/symbols';
import { Copy, DoorOpen, Download, PanelsTopLeft, Trash2, Upload } from 'lucide-react';
import { joineryProblem, type JoineryKind, type JoinerySpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useProjectStore } from '@/project/project-store';
import {
  addJoinery, applyJoineryToSelection, importJoinery, pushJoinery, removeJoinery, setCurrentJoinery, updateJoinery,
} from '@/joinery/catalog';
import { closeJoinery, useJoineryDialog } from '@/joinery/dialog-store';
import { joineryCatalogueText, parseJoineryCatalogue } from '@/joinery/spec-file';
import { elevationSymbol, planSymbol, sectionSymbol } from '@/joinery/symbols';
import { FinishFields, GeneralFields, ProfileFields, PropertyFields } from './JoineryFields';
import { JoineryGrid, type Cell } from './JoineryGrid';
import { JoineryDrawing, JoineryElevation, JoineryIso } from './JoineryPreview';

type Filter = 'all' | JoineryKind;

function Thumb({ spec }: { spec: JoinerySpec }) {
  return <JoineryDrawing strokes={elevationSymbol(spec, { convention: useOpeningConvention() })} label="" width={36} height={44} />;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function JoineryDialog() {
  const { t } = useTranslation();
  const open = useJoineryDialog((s) => s.open);
  const selectedId = useJoineryDialog((s) => s.selectedId);
  const types = useProjectStore((s) => s.joineryTypes) ?? [];
  const current = useProjectStore((s) => s.currentJoinery) ?? {};
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState<JoinerySpec | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const saved = types.find((x) => x.id === selectedId) ?? null;

  useEffect(() => {
    setDraft(saved ? structuredClone(saved) : null);
    setCell(null);
    // A different entry (or the saved one changed under us).
  }, [selectedId, saved]);

  const shown = types.filter((x) => filter === 'all' || x.kind === filter);
  const select = (id: string | null) => useJoineryDialog.setState({ selectedId: id });
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const problem = draft ? joineryProblem(draft) : null;
  const convention = useOpeningConvention();
  const strokes = useMemo(() => (draft && !problem ? {
    exterior: elevationSymbol(draft, { side: 'exterior', convention }), plan: planSymbol(draft), section: sectionSymbol(draft),
  } : null), [draft, problem, convention]);

  const save = () => {
    if (!draft || problem) return;
    updateJoinery(draft);
    const result = pushJoinery(draft);
    if (result.refused.length) toast.error(t('joinery.refused', { reasons: result.refused.join('; ') }));
    else toast.success(result.updated ? t('joinery.saved', { count: result.updated }) : t('joinery.savedNone'));
  };
  const applySelection = () => {
    if (!saved) return;
    const result = applyJoineryToSelection(saved);
    if (result.updated === 0 && result.refused.length === 0) toast.info(t('joinery.nothingSelected'));
    else if (result.refused.length) toast.error(t('joinery.refused', { reasons: result.refused.join('; ') }));
    else toast.success(t('joinery.applied', { count: result.updated, name: saved.name }));
  };
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const count = importJoinery(parseJoineryCatalogue(await file.text()));
        toast.success(t('joinery.imported', { count }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    };
    input.click();
  };
  const kindLabel = (kind: JoineryKind) => t(kind === 'door' ? 'joinery.kind.door' : 'joinery.kind.window');
  const isCurrent = !!saved && current[saved.kind] === saved.id;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeJoinery(); }}>
      <DialogContent className="sm:max-w-[1180px] max-h-[92vh] overflow-hidden">
        <DialogHeader><DialogTitle>{t('joinery.title')}</DialogTitle></DialogHeader>
        <div className="grid h-[70vh] grid-cols-[13rem_19rem_1fr] gap-3 text-xs">
          <aside className="flex min-h-0 flex-col gap-2">
            <div className="flex gap-1" role="tablist" aria-label={t('joinery.title')}>
              {(['all', 'window', 'door'] as const).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f}
                  className={`rounded-sm px-2 py-1 ${filter === f ? 'bg-primary/15 text-primary' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                  onClick={() => setFilter(f)}>{t(`joinery.filter.${f}`)}</button>
              ))}
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label={t('joinery.title')}>
              {shown.length === 0 ? <li className="p-2 text-zinc-500">{t('joinery.empty')}</li> : shown.map((x) => (
                <li key={x.id}>
                  <button type="button" aria-current={x.id === selectedId}
                    className={`flex w-full items-center gap-2 rounded-md border p-1 text-left ${x.id === selectedId ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    onClick={() => select(x.id ?? null)}>
                    <Thumb spec={x} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{x.name}</span>
                      <span className="text-zinc-500">{x.mark} · {Math.round(x.width * 1000)}×{Math.round(x.height * 1000)}</span>
                    </span>
                    {current[x.kind] === x.id ? <span className="size-2 rounded-full bg-primary" title={t('joinery.current', { kind: kindLabel(x.kind) })} /> : null}
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-1">
              <Button size="sm" variant="outline" onClick={() => select(addJoinery('window'))}><PanelsTopLeft className="mr-1 size-3.5" />{t('joinery.newWindow')}</Button>
              <Button size="sm" variant="outline" onClick={() => select(addJoinery('door'))}><DoorOpen className="mr-1 size-3.5" />{t('joinery.newDoor')}</Button>
              <Button size="sm" variant="ghost" onClick={importFile}><Upload className="mr-1 size-3.5" />{t('joinery.import')}</Button>
              <Button size="sm" variant="ghost" disabled={types.length === 0} onClick={() => download('joinery-catalogue.json', joineryCatalogueText(types))}>
                <Download className="mr-1 size-3.5" />{t('joinery.export')}
              </Button>
            </div>
            <label className="space-y-0.5 text-2xs text-zinc-500">
              <span className="block">{t('joinery.openingLines')}</span>
              <select aria-label={t('joinery.openingLines')} className="h-7 w-full rounded-sm border border-zinc-300 bg-transparent px-1 text-xs dark:border-zinc-700"
                value={convention} onChange={(e) => setOpeningConvention(e.target.value as OpeningConvention)}>
                <option value="handle">{t('joinery.openingLines.handle')}</option>
                <option value="hinge">{t('joinery.openingLines.hinge')}</option>
              </select>
            </label>
          </aside>

          {draft && saved ? (
            <>
              <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate text-sm font-semibold">{draft.name}</span>
                  <IconButton label={t('joinery.duplicate')} className="size-7" onClick={() => select(addJoinery(saved.kind, saved))}><Copy className="size-3.5" /></IconButton>
                  <IconButton label={t('joinery.delete', { name: saved.name })} className="size-7" onClick={() => { if (saved.id) removeJoinery(saved.id); select(null); }}><Trash2 className="size-3.5" /></IconButton>
                </div>
                <GeneralFields spec={draft} onChange={setDraft} />
                <JoineryGrid spec={draft} onChange={setDraft} selected={cell} onSelect={setCell} />
                <ProfileFields spec={draft} onChange={setDraft} />
                <FinishFields spec={draft} onChange={setDraft} />
                <PropertyFields spec={draft} onChange={setDraft} />
              </div>
              <div className="min-h-0 overflow-y-auto">
                {problem ? <p role="alert" className="mb-2 rounded-sm bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{t('joinery.problem', { reason: problem })}</p> : null}
                {strokes ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <JoineryElevation spec={draft} label={t('joinery.view.elevation')} selected={cell} onSelect={setCell} width={250} height={290} />
                    <JoineryIso spec={draft} label={t('joinery.view.model')} width={250} height={290} />
                    <JoineryDrawing strokes={strokes.exterior} label={t('joinery.view.exterior')} width={160} height={190} />
                    <JoineryDrawing strokes={strokes.section} label={t('joinery.view.section')} width={110} height={190} />
                    <JoineryDrawing strokes={strokes.plan} label={t('joinery.view.plan')} width={250} height={140} />
                  </div>
                ) : null}
              </div>
            </>
          ) : <p className="col-span-2 self-center text-center text-zinc-500">{t('joinery.empty')}</p>}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-2 text-xs">
            {/* Placing and retyping change the model: the full edition only. */}
            {saved && can('modelling') ? (
              <>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={isCurrent} onChange={(e) => setCurrentJoinery(saved.kind, e.target.checked ? saved.id ?? null : null)} />
                  {t('joinery.useForPlacing')}
                </label>
                <Button size="sm" variant="outline" disabled={dirty} onClick={applySelection}>{t('joinery.applySelection')}</Button>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => saved && setDraft(structuredClone(saved))}>{t('joinery.revert')}</Button>
            <Button size="sm" disabled={!dirty || !!problem} onClick={save}>{t('joinery.save')}</Button>
            <Button size="sm" variant="outline" onClick={closeJoinery}>{t('joinery.close')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
