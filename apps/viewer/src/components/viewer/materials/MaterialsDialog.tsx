/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Building materials: every IfcMaterial of the loaded models, and any the
 * user adds. Each has a surface colour (its colour in 3D) and, for each
 * kind of view, how it draws:
 *
 * - Section: where a section cuts it (and a plan, unless Top view says otherwise);
 * - Top view: where a plan cuts it;
 * - Front view: the faces an elevation sees.
 *
 * A material with no row shows what the IFC file gives it, else what its
 * name suggests; Reset goes back to that. Drawings change at once; the
 * colour and hatches are written into the editable IFC models (3D and the
 * exported file) on "Apply to models" or when the dialog closes.
 */

import { useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { toast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProjectStore } from '@/project/project-store';
import { useViewerStore } from '@/store';
import { builtInPatterns } from '@/drafting/hatch/library';
import { parsePat } from '@/drafting/hatch/pattern';
import { clearMaterialView, materialGraphics, materialNamesInModels, normaliseMaterialName, resetMaterial, setMaterial, setMaterialView } from '@/project/materials';
import { pushMaterials } from '@/project/material-ifc-sync';
import type { CategoryLineWeight, MaterialViewGraphics, MaterialViewKind, ProjectMaterial } from '@/project/types';
import { MaterialSwatch } from './MaterialSwatch';

export const useMaterialsDialog = create<{ open: boolean }>()(() => ({ open: false }));
export const openMaterials = () => useMaterialsDialog.setState({ open: true });

const CELL = 'h-7 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs';
const PENS: CategoryLineWeight[] = ['hairline', 'light', 'medium', 'heavy'];
const KINDS: MaterialViewKind[] = ['section', 'plan', 'elevation'];

/** The fill a kind of view sets itself (undefined: it does not). */
function ownFill(own: ProjectMaterial | undefined, kind: MaterialViewKind): string | null | undefined {
  if (!own) return undefined;
  if (kind === 'elevation') return own.views?.elevation?.fill;
  if (kind === 'plan' && own.views?.plan && 'fill' in own.views.plan) return own.views.plan.fill;
  return own.fill;
}

/** The fill choice shown: none, a colour of its own, or the material's colour. */
function fillMode(fill: string | null | undefined, color: string | undefined, own: string | null | undefined): 'material' | 'none' | 'own' {
  if (fill === null) return 'none';
  if (own) return 'own';
  return fill && fill !== color ? 'own' : 'material';
}

export function MaterialsDialog() {
  const { t } = useTranslation();
  const open = useMaterialsDialog((s) => s.open);
  const table = useProjectStore((s) => s.materials);
  const patternText = useProjectStore((s) => s.hatchPatterns ?? '');
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const extra = useMemo(() => parsePat(patternText).patterns, [patternText]);
  const patterns = useMemo(() => [...builtInPatterns(), ...extra].map((p) => p.name), [extra]);
  const [adding, setAdding] = useState('');
  const [kind, setKind] = useState<MaterialViewKind>('section');
  const pending = useRef(new Set<string>());
  const [pendingCount, setPendingCount] = useState(0);
  const names = useMemo(() => { void table; void mutationVersion; return open ? materialNamesInModels() : []; }, [open, table, mutationVersion]);

  const touched = (name: string) => { pending.current.add(name); setPendingCount(pending.current.size); };
  const apply = () => {
    const list = [...pending.current];
    pending.current.clear();
    setPendingCount(0);
    if (list.length === 0) return;
    const report = pushMaterials(list);
    if (report.models) toast.success(t('materials.pushed', { models: report.models, elements: report.elements }));
    if (report.refused.length) toast.error(t('materials.pushRefused', { count: report.refused.length }));
  };
  const close = () => { apply(); useMaterialsDialog.setState({ open: false }); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else useMaterialsDialog.setState({ open: true }); }}>
      <DialogContent className="sm:max-w-[980px] max-h-[90vh] overflow-hidden">
        <DialogHeader><DialogTitle>{t('materials.title')}</DialogTitle></DialogHeader>
        <p className="text-xs text-zinc-500">{t('materials.hint')}</p>
        <div className="flex items-center gap-3">
          <SegmentedControl label={t('materials.viewKind')} size="sm" value={kind} onValueChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: t(`materials.kind.${k}`) }))} />
          <span className="text-2xs text-zinc-500">{t(`materials.kindHint.${kind}`)}</span>
        </div>
        <div className="max-h-[56vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-zinc-950">
              <tr className="text-left text-zinc-500">
                <th className="w-12" aria-label={t('materials.col.swatch')} />
                <th className="font-medium">{t('materials.col.name')}</th>
                <th className="w-20 font-medium">{t('materials.col.color')}</th>
                <th className="font-medium">{t('materials.col.hatch')}</th>
                <th className="w-16 font-medium">{t('materials.col.scale')}</th>
                <th className="w-40 font-medium">{t('materials.col.fill')}</th>
                <th className="w-24 font-medium">{t('materials.col.pen')}</th>
                <th className="w-20 font-medium">{t('materials.col.membrane')}</th>
                <th className="w-8" aria-label={t('materials.reset')} />
              </tr>
            </thead>
            <tbody>
              {names.length === 0 ? <tr><td colSpan={9} className="p-2 text-zinc-500">{t('materials.none')}</td></tr> : names.map((name) => {
                const g = materialGraphics(name, table ?? [], kind);
                const own = (table ?? []).find((m) => normaliseMaterialName(m.name) === normaliseMaterialName(name));
                const overridden = kind !== 'section' && !!own?.views?.[kind];
                const set = (patch: MaterialViewGraphics) => { setMaterialView(name, kind, patch); touched(name); };
                const off = g.membrane && kind !== 'elevation';
                const mode = fillMode(g.fill, g.color, ownFill(own, kind));
                return (
                  <tr key={name} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td><MaterialSwatch pattern={g.hatch} scale={g.hatchScale ?? 1} fill={g.fill === undefined ? g.color : g.fill} membrane={off} extra={extra} /></td>
                    <td className="truncate pr-2">
                      <span className="font-medium">{name}</span>
                      {g.source !== 'own' ? <span className="ml-1 text-2xs text-zinc-400">{t(`materials.source.${g.source}`)}</span> : null}
                      {kind === 'plan' && !overridden ? <span className="ml-1 text-2xs text-zinc-400">{t('materials.asSection')}</span> : null}
                    </td>
                    <td>
                      <input type="color" aria-label={t('materials.colorOf', { name })} className="h-6 w-9 cursor-pointer border-0 bg-transparent p-0 align-middle"
                        value={g.color ?? '#c8c8c8'} onChange={(e) => { setMaterial(name, { color: e.target.value }); touched(name); }} />
                      {!g.color ? <span className="ml-1 text-2xs text-zinc-400">{t('materials.noColor')}</span> : null}
                    </td>
                    <td>
                      <select aria-label={t('materials.hatchOf', { name })} className={CELL} value={g.hatch ?? ''} disabled={off} onChange={(e) => set({ hatch: e.target.value || null })}>
                        <option value="">{t('materials.noHatch')}</option>
                        {patterns.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <input aria-label={t('materials.scaleOf', { name })} className={`${CELL} w-14`} inputMode="decimal" defaultValue={g.hatchScale ?? 1} key={`${name}:${kind}:${g.hatchScale}`} disabled={off}
                        onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); if (v > 0 && v !== (g.hatchScale ?? 1)) set({ hatchScale: v }); }} />
                    </td>
                    <td className="whitespace-nowrap">
                      <select aria-label={t('materials.fillModeOf', { name })} className={CELL} disabled={off}
                        value={mode}
                        onChange={(e) => set({ fill: e.target.value === 'material' ? undefined : e.target.value === 'none' ? null : g.fill ?? '#d4d4d8' })}>
                        <option value="material">{t('materials.fill.ifc')}</option>
                        <option value="none">{t('materials.fill.none')}</option>
                        <option value="own">{t('materials.fill.own')}</option>
                      </select>
                      {mode === 'own' && g.fill ? <input type="color" aria-label={t('materials.fillOf', { name })} className="ml-1 h-5 w-7 cursor-pointer border-0 bg-transparent p-0 align-middle" value={g.fill} onChange={(e) => set({ fill: e.target.value })} /> : null}
                    </td>
                    <td>
                      <select aria-label={t('materials.penOf', { name })} className={CELL} value={g.hatchPen ?? 'hairline'} disabled={off} onChange={(e) => set({ hatchPen: e.target.value as CategoryLineWeight })}>
                        {PENS.map((p) => <option key={p} value={p}>{t(`materials.pen.${p}`)}</option>)}
                      </select>
                    </td>
                    <td><input type="checkbox" aria-label={t('materials.membraneOf', { name })} checked={!!g.membrane} onChange={(e) => setMaterial(name, { membrane: e.target.checked })} /></td>
                    <td>
                      {overridden ? <IconButton label={t('materials.useSection')} className="size-6" onClick={() => { clearMaterialView(name, kind as 'plan' | 'elevation'); touched(name); }}><RotateCcw className="size-3" /></IconButton>
                        : kind === 'section' && !g.auto ? <IconButton label={t('materials.reset')} className="size-6" onClick={() => { resetMaterial(name); touched(name); }}><RotateCcw className="size-3" /></IconButton> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="flex gap-1">
            <input aria-label={t('materials.newName')} placeholder={t('materials.newName')} className={`${CELL} w-56`} value={adding} onChange={(e) => setAdding(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!adding.trim()} onClick={() => { setMaterial(adding.trim(), {}); setAdding(''); }}>{t('materials.add')}</Button>
          </span>
          <span className="flex gap-1">
            <Button size="sm" variant="outline" disabled={pendingCount === 0} title={t('materials.applyHint')} onClick={apply}>{t('materials.apply', { count: pendingCount })}</Button>
            <Button size="sm" onClick={close}>{t('materials.close')}</Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
