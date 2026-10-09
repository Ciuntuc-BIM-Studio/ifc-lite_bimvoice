/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Building materials (ArchiCAD style): every IfcMaterial of the loaded
 * models, and any the user adds, with how a cut shows it — the hatch and
 * its scale and pen, the fill behind it, or a heavy dashed line for a
 * membrane. A row the user has not touched shows what the material's name
 * suggests ("auto"); Reset goes back to that. Changes apply to every view,
 * sheet and DXF at once.
 */

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProjectStore } from '@/project/project-store';
import { useViewerStore } from '@/store';
import { builtInPatterns, findPattern } from '@/drafting/hatch/library';
import { hatchSegments } from '@/drafting/hatch/fill';
import { HATCH_UNIT_M } from '@/drafting/annotation';
import { parsePat, type HatchPattern } from '@/drafting/hatch/pattern';
import { materialGraphics, materialNamesInModels, resetMaterial, setMaterial } from '@/project/materials';
import type { CategoryLineWeight } from '@/project/types';

export const useMaterialsDialog = create<{ open: boolean }>()(() => ({ open: false }));
export const openMaterials = () => useMaterialsDialog.setState({ open: true });

const CELL = 'h-7 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs';
const PENS: CategoryLineWeight[] = ['hairline', 'light', 'medium', 'heavy'];

/** A small square of the hatch, as it prints. */
function Swatch({ pattern, scale, fill, membrane, extra }: { pattern: string | null | undefined; scale: number; fill: string | null | undefined; membrane?: boolean; extra: readonly HatchPattern[] }) {
  const size = 34;
  const lines = useMemo(() => {
    const p = pattern ? findPattern(pattern, extra) : undefined;
    if (!p || p.solid) return { solid: !!p?.solid, d: '' };
    // 1.5 m of drawing, hatched as a plan hatches it.
    const m = 1.5;
    const box = [{ x: 0, y: 0 }, { x: m, y: 0 }, { x: m, y: m }, { x: 0, y: m }];
    const segs = hatchSegments([box], p, { scale: scale * HATCH_UNIT_M, angleDeg: 0, maxSegments: 2000 }).segments;
    const k = size / m;
    return { solid: false, d: segs.map((s) => `M${(s.a.x * k).toFixed(1)} ${(size - s.a.y * k).toFixed(1)}L${(s.b.x * k).toFixed(1)} ${(size - s.b.y * k).toFixed(1)}`).join('') };
  }, [pattern, scale, extra]);
  return (
    <svg width={size} height={size / 2} viewBox={`0 ${size / 4} ${size} ${size / 2}`} aria-hidden="true" className="rounded-sm border border-zinc-300 bg-white dark:border-zinc-600">
      <rect x={0} y={0} width={size} height={size} fill={lines.solid ? '#000' : fill ?? '#fff'} />
      {membrane ? <line x1={2} x2={size - 2} y1={size / 2} y2={size / 2} stroke="#000" strokeWidth={2} strokeDasharray="5 3" /> : <path d={lines.d} stroke="#000" strokeWidth={0.6} fill="none" />}
    </svg>
  );
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
  const names = useMemo(() => { void table; void mutationVersion; return open ? materialNamesInModels() : []; }, [open, table, mutationVersion]);
  return (
    <Dialog open={open} onOpenChange={(o) => useMaterialsDialog.setState({ open: o })}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-hidden">
        <DialogHeader><DialogTitle>{t('materials.title')}</DialogTitle></DialogHeader>
        <p className="text-xs text-zinc-500">{t('materials.hint')}</p>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-zinc-950">
              <tr className="text-left text-zinc-500">
                <th className="w-12" aria-label={t('materials.col.swatch')} />
                <th className="font-medium">{t('materials.col.name')}</th>
                <th className="font-medium">{t('materials.col.hatch')}</th>
                <th className="w-16 font-medium">{t('materials.col.scale')}</th>
                <th className="w-36 font-medium">{t('materials.col.fill')}</th>
                <th className="w-24 font-medium">{t('materials.col.pen')}</th>
                <th className="w-20 font-medium">{t('materials.col.membrane')}</th>
                <th className="w-8" aria-label={t('materials.reset')} />
              </tr>
            </thead>
            <tbody>
              {names.length === 0 ? <tr><td colSpan={8} className="p-2 text-zinc-500">{t('materials.none')}</td></tr> : names.map((name) => {
                const g = materialGraphics(name, table ?? []);
                const set = (patch: Parameters<typeof setMaterial>[1]) => setMaterial(name, patch);
                return (
                  <tr key={name} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td><Swatch pattern={g.hatch} scale={g.hatchScale ?? 1} fill={g.fill} membrane={g.membrane} extra={extra} /></td>
                    <td className="truncate pr-2">
                      <span className="font-medium">{name}</span>
                      {g.auto ? <span className="ml-1 text-2xs text-zinc-400">{t('materials.auto')}</span> : null}
                    </td>
                    <td>
                      <select aria-label={t('materials.hatchOf', { name })} className={CELL} value={g.hatch ?? ''} disabled={g.membrane} onChange={(e) => set({ hatch: e.target.value || null })}>
                        <option value="">{t('materials.noHatch')}</option>
                        {patterns.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <input aria-label={t('materials.scaleOf', { name })} className={`${CELL} w-14`} inputMode="decimal" defaultValue={g.hatchScale ?? 1} key={`${name}:${g.hatchScale}`} disabled={g.membrane}
                        onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); if (v > 0) set({ hatchScale: v }); }} />
                    </td>
                    <td className="whitespace-nowrap">
                      <select aria-label={t('materials.fillModeOf', { name })} className={CELL} disabled={g.membrane}
                        value={g.fill === undefined ? 'ifc' : g.fill === null ? 'none' : 'own'}
                        onChange={(e) => set({ fill: e.target.value === 'ifc' ? undefined : e.target.value === 'none' ? null : g.fill ?? '#d4d4d8' })}>
                        <option value="ifc">{t('materials.fill.ifc')}</option>
                        <option value="none">{t('materials.fill.none')}</option>
                        <option value="own">{t('materials.fill.own')}</option>
                      </select>
                      {g.fill ? <input type="color" aria-label={t('materials.fillOf', { name })} className="ml-1 h-5 w-7 cursor-pointer border-0 bg-transparent p-0 align-middle" value={g.fill} onChange={(e) => set({ fill: e.target.value })} /> : null}
                    </td>
                    <td>
                      <select aria-label={t('materials.penOf', { name })} className={CELL} value={g.hatchPen ?? 'hairline'} disabled={g.membrane} onChange={(e) => set({ hatchPen: e.target.value as CategoryLineWeight })}>
                        {PENS.map((p) => <option key={p} value={p}>{t(`materials.pen.${p}`)}</option>)}
                      </select>
                    </td>
                    <td><input type="checkbox" aria-label={t('materials.membraneOf', { name })} checked={!!g.membrane} onChange={(e) => set({ membrane: e.target.checked })} /></td>
                    <td>{!g.auto ? <IconButton label={t('materials.reset')} className="size-6" onClick={() => resetMaterial(name)}><RotateCcw className="size-3" /></IconButton> : null}</td>
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
          <Button size="sm" variant="outline" onClick={() => useMaterialsDialog.setState({ open: false })}>{t('materials.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
