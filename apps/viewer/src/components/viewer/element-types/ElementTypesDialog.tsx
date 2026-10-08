/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's element types: walls, slabs, columns, beams, roofs and
 * openings. The kind's entries on the left, the selected entry's fields in
 * the middle, its build-up drawn on the right. Edits stay a draft until
 * Save, which updates the catalogue and every element of that type already
 * in the models (`pushElementType`). From here an entry is made the one the
 * kind's Design tool builds with, or applied to the selection.
 */

import { useEffect, useState } from 'react';
import { Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useProjectStore } from '@/project/project-store';
import { addElementType, exportElementTypes, importElementTypes, removeElementType, setCurrentType, updateElementType } from '@/element-types/catalog';
import { applyTypeToSelection, pushElementType } from '@/element-types/model-sync';
import { closeElementTypes, useTypesDialog } from '@/element-types/dialog-store';
import { ELEMENT_TYPE_KINDS, layersThickness, type ElementTypeKind, type ElementTypeSpec } from '@/element-types/spec';
import { Field, LayerPreview, TypeFields } from './TypeFields';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** A list row's second line: what sets the entry apart at a glance. */
function summary(spec: ElementTypeSpec): string {
  const mm = (m: number) => Math.round(m * 1000);
  switch (spec.kind) {
    case 'wall': case 'slab': return `${mm(layersThickness(spec.layers))} mm · ${spec.layers.length}`;
    case 'roof': return `${spec.pitch}° · ${mm(layersThickness(spec.layers))} mm`;
    case 'opening': return `${mm(spec.width)}×${mm(spec.height)}`;
    default: return spec.section.Type === 'Rectangle' ? `${mm(spec.section.XDim)}×${mm(spec.section.YDim)}` : spec.section.Type;
  }
}

export function ElementTypesDialog() {
  const { t } = useTranslation();
  const open = useTypesDialog((s) => s.open);
  const kind = useTypesDialog((s) => s.kind);
  const selectedId = useTypesDialog((s) => s.selectedId);
  const types = useProjectStore((s) => s.elementTypes) ?? [];
  const current = useProjectStore((s) => s.currentTypes) ?? {};
  const [draft, setDraft] = useState<ElementTypeSpec | null>(null);
  const saved = types.find((x) => x.id === selectedId && x.kind === kind) ?? null;

  useEffect(() => {
    setDraft(saved ? structuredClone(saved) : null);
  }, [selectedId, saved]);

  const shown = types.filter((x) => x.kind === kind);
  const select = (id: string | null) => useTypesDialog.setState({ selectedId: id });
  const setKind = (k: ElementTypeKind) => useTypesDialog.setState({ kind: k, selectedId: types.find((x) => x.kind === k)?.id ?? null });
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const isCurrent = !!saved && current[saved.kind] === saved.id;

  const save = () => {
    if (!draft) return;
    updateElementType(draft);
    const report = pushElementType(draft);
    if (report.refused.length) toast.error(t('elementTypes.refused', { reasons: report.refused.slice(0, 3).join('; ') }));
    else toast.success(report.elements ? t('elementTypes.saved', { count: report.elements }) : t('elementTypes.savedNone'));
  };
  const applySelection = () => {
    if (!saved) return;
    const result = applyTypeToSelection(saved);
    if (result.updated === 0 && result.refused.length === 0) toast.info(t('elementTypes.nothingSelected', { kind: t(`elementTypes.kind.${saved.kind}`) }));
    else if (result.refused.length) toast.error(t('elementTypes.refused', { reasons: result.refused.join('; ') }));
    else toast.success(t('elementTypes.applied', { count: result.updated, name: saved.name }));
  };
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        toast.success(t('elementTypes.imported', { count: importElementTypes(await file.text()) }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    };
    input.click();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeElementTypes(); }}>
      <DialogContent className="sm:max-w-[980px] max-h-[92vh] overflow-hidden">
        <DialogHeader><DialogTitle>{t('elementTypes.title')}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-1 text-xs" role="tablist" aria-label={t('elementTypes.title')}>
          {ELEMENT_TYPE_KINDS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k}
              className={`rounded-sm px-2 py-1 ${kind === k ? 'bg-primary/15 text-primary' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
              onClick={() => setKind(k)}>{t(`elementTypes.kind.${k}`)}</button>
          ))}
        </div>
        <div className="grid h-[62vh] grid-cols-[13rem_1fr_15rem] gap-3 text-xs">
          <aside className="flex min-h-0 flex-col gap-2">
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label={t(`elementTypes.kind.${kind}`)}>
              {shown.length === 0 ? <li className="p-2 text-zinc-500">{t('elementTypes.empty')}</li> : shown.map((x) => (
                <li key={x.id}>
                  <button type="button" aria-current={x.id === selectedId}
                    className={`flex w-full items-center gap-2 rounded-md border p-1.5 text-left ${x.id === selectedId ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    onClick={() => select(x.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{x.name}</span>
                      <span className="text-zinc-500">{x.mark} · {summary(x)}</span>
                    </span>
                    {current[x.kind] === x.id ? <span className="size-2 rounded-full bg-primary" title={t('elementTypes.current')} /> : null}
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-1">
              <Button size="sm" variant="outline" className="col-span-2" onClick={() => select(addElementType(kind))}><Plus className="mr-1 size-3.5" />{t('elementTypes.new', { kind: t(`elementTypes.kind.${kind}`) })}</Button>
              <Button size="sm" variant="ghost" onClick={importFile}><Upload className="mr-1 size-3.5" />{t('elementTypes.import')}</Button>
              <Button size="sm" variant="ghost" disabled={types.length === 0} onClick={() => download('element-types.json', exportElementTypes())}>
                <Download className="mr-1 size-3.5" />{t('elementTypes.export')}
              </Button>
            </div>
          </aside>
          {draft && saved ? (
            <>
              <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate text-sm font-semibold">{draft.name}</span>
                  <IconButton label={t('elementTypes.duplicate')} className="size-7" onClick={() => select(addElementType(saved.kind, saved))}><Copy className="size-3.5" /></IconButton>
                  <IconButton label={t('elementTypes.delete', { name: saved.name })} className="size-7" onClick={() => { removeElementType(saved.id); select(null); }}><Trash2 className="size-3.5" /></IconButton>
                </div>
                <Field label={t('elementTypes.name')}>
                  <input aria-label={t('elementTypes.name')} className="h-6 w-full rounded-sm border border-zinc-300 bg-transparent px-1 dark:border-zinc-700" value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Field>
                <Field label={t('elementTypes.mark')}>
                  <input aria-label={t('elementTypes.mark')} className="h-6 w-full rounded-sm border border-zinc-300 bg-transparent px-1 dark:border-zinc-700" value={draft.mark}
                    onChange={(e) => setDraft({ ...draft, mark: e.target.value })} />
                </Field>
                <TypeFields spec={draft} onChange={setDraft} />
              </div>
              <div className="min-h-0 space-y-2 overflow-y-auto">
                <LayerPreview spec={draft} />
                <p className="text-zinc-500">{t(`elementTypes.hint.${draft.kind}`)}</p>
              </div>
            </>
          ) : <p className="col-span-2 self-center text-center text-zinc-500">{t('elementTypes.empty')}</p>}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-2 text-xs">
            {saved ? (
              <>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={isCurrent} onChange={(e) => setCurrentType(saved.kind, e.target.checked ? saved.id : null)} />
                  {t('elementTypes.useForNew')}
                </label>
                {saved.kind !== 'opening' ? <Button size="sm" variant="outline" disabled={dirty} onClick={applySelection}>{t('elementTypes.applySelection')}</Button> : null}
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => saved && setDraft(structuredClone(saved))}>{t('elementTypes.revert')}</Button>
            <Button size="sm" disabled={!dirty || !draft?.name.trim()} onClick={save}>{t('elementTypes.save')}</Button>
            <Button size="sm" variant="outline" onClick={closeElementTypes}>{t('elementTypes.close')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
