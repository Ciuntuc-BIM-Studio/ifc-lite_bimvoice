/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The drafted entity's way into the model (`project/draft-to-bim.ts`):
 * drafting stays out of the IFC until it is made into an element here — or
 * shows the element it already drives.
 */

import { useState } from 'react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { activeWorkPlane, draftSettings } from '@/drafting/session';
import { useProjectStore } from '@/project/project-store';
import { bimKindsFor, convertDraftToBim, type DraftBimKind } from '@/project/draft-to-bim';
import type { DraftEntity } from '@/drafting/types';
import { currentRoofPreset } from '@/element-types/roof-preset';

const EXTRUDE_CLASSES = [
  'IfcBuildingElementProxy', 'IfcWall', 'IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcMember', 'IfcPlate', 'IfcFooting',
  'IfcCovering', 'IfcRailing', 'IfcStair', 'IfcRamp', 'IfcChimney', 'IfcFurnishingElement',
];

const KIND_KEYS: Record<DraftBimKind, TranslationKey> = {
  wall: 'drafting.bim.kind.wall', beam: 'drafting.bim.kind.beam', railing: 'drafting.bim.kind.railing',
  slab: 'drafting.bim.kind.slab', roof: 'drafting.bim.kind.roof', extrude: 'drafting.bim.kind.extrude',
};

const field = 'h-6 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1';

export function DraftBimFields({ entity }: { entity: DraftEntity }) {
  const { t } = useTranslation();
  const { view, plane } = activeWorkPlane();
  const kinds = bimKindsFor(entity, view);
  const [picked, setPicked] = useState<DraftBimKind | null>(null);
  const [ifcClass, setIfcClass] = useState(() => draftSettings().extrudeClass);
  const [depth, setDepth] = useState(() => draftSettings().extrudeDepth);
  const [pitch, setPitch] = useState(() => currentRoofPreset()?.defaults.pitch ?? draftSettings().roofSlope);
  const kind = picked && kinds.includes(picked) ? picked : kinds[0];
  const p = entity.params;

  let status: string;
  if (p.ifcGlobalId) status = t('drafting.bim.linked', { ifcClass: String(p.ifcClass ?? ''), guid: String(p.ifcGlobalId) });
  else if (p.bimClass) status = t('drafting.bim.made', { count: String(p.bimElements ?? '').split(' ').filter(Boolean).length, ifcClass: String(p.bimClass) });
  else status = t('drafting.bim.draftOnly');

  const convert = () => {
    if (!kind || !view || !plane) return;
    const entities = useProjectStore.getState().drafts.filter((d) => d.viewId === entity.viewId);
    const s = draftSettings();
    const result = convertDraftToBim(entity, kind, view, plane, entities, {
      ifcClass, depth,
      roof: { shape: s.roofKind === 'flat' ? 'hip' : s.roofKind, pitch, overhang: s.roofOverhang, thickness: s.roofThickness <= 0.15 ? s.roofThickness : 0.08 },
    });
    if (result.ok) toast.success(t('drafting.bim.converted', { count: result.count, ifcClass: result.ifcClass }));
    else toast.error(t('drafting.bim.failed', { reason: result.error }));
  };

  return (
    <div className="space-y-1 border-t border-zinc-200 dark:border-zinc-800 pt-2">
      <h4 className="font-semibold text-zinc-700 dark:text-zinc-300">{t('drafting.bim.title')}</h4>
      <p className="text-zinc-500 break-all">{status}</p>
      {kind ? <>
        <Line label={t('drafting.bim.make')}>
          <select aria-label={t('drafting.bim.make')} className={field} value={kind} onChange={(e) => setPicked(e.target.value as DraftBimKind)}>
            {kinds.map((k) => <option key={k} value={k}>{t(KIND_KEYS[k])}</option>)}
          </select>
        </Line>
        {kind === 'extrude' ? <>
          <Line label={t('drafting.bim.class')}>
            <select aria-label={t('drafting.bim.class')} className={field} value={ifcClass} onChange={(e) => setIfcClass(e.target.value)}>
              {[...new Set([ifcClass, ...EXTRUDE_CLASSES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Line>
          <Line label={t('drafting.bim.depth')}>
            <input aria-label={t('drafting.bim.depth')} type="number" step="0.05" className={field} value={depth} onChange={(e) => setDepth(Number(e.target.value) || depth)} />
          </Line>
        </> : null}
        {kind === 'roof' ? (
          <Line label={t('drafting.bim.pitch')}>
            <input aria-label={t('drafting.bim.pitch')} type="number" min={0} max={80} className={field} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
          </Line>
        ) : null}
        <Button size="sm" className="h-6 w-full" onClick={convert}>{t('drafting.bim.convert')}</Button>
      </> : null}
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-zinc-500">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
