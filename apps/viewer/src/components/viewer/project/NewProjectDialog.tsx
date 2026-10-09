/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * New Project: configure the IfcProject, IfcSite (address and geographic
 * reference), IfcBuilding, the levels, units and schema, then start a fresh
 * model with them. Mounted once (with the left navigator) and opened by the
 * `ifc-lite:new-project` event, from the File tab, the navigator or the
 * welcome screen.
 */

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useIfc } from '@/hooks/useIfc';
import { resetPackageSession } from '@/project/package/session';
import { setProjectName } from '@/project/project-store';
import {
  defaultNewProjectSpec, generateLevels, NEW_PROJECT_EVENT, newProjectFile, validateNewProject, type NewProjectSpec,
} from '@/project/new-project';

const SCHEMAS: readonly NewProjectSpec['schema'][] = ['IFC4', 'IFC4X3', 'IFC2X3'];
const INPUT = 'w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const optionalNumber = (text: string): number | null => {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function NewProjectHost() {
  const { t } = useTranslation();
  const { loadFile } = useIfc();
  const [open, setOpen] = useState(false);
  const [spec, setSpec] = useState<NewProjectSpec>(defaultNewProjectSpec);
  const [geo, setGeo] = useState({ lat: '', lon: '', elev: '' });
  const [gen, setGen] = useState({ above: '2', below: '0', height: '3' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onRequest = () => {
      setSpec(defaultNewProjectSpec());
      setGeo({ lat: '', lon: '', elev: '' });
      setOpen(true);
    };
    window.addEventListener(NEW_PROJECT_EVENT, onRequest);
    return () => window.removeEventListener(NEW_PROJECT_EVENT, onRequest);
  }, []);

  const set = <K extends keyof NewProjectSpec>(key: K, value: NewProjectSpec[K]) => setSpec((s) => ({ ...s, [key]: value }));
  const full: NewProjectSpec = { ...spec, latitude: optionalNumber(geo.lat), longitude: optionalNumber(geo.lon), siteElevation: optionalNumber(geo.elev) };
  const problems = validateNewProject(full);

  const create = async () => {
    if (problems.length > 0) return;
    setBusy(true);
    try {
      await loadFile(newProjectFile(full), { kind: 'primary', modelId: crypto.randomUUID() });
      setProjectName(full.projectName);
      resetPackageSession();
      setOpen(false);
      toast.success(t('newProject.created', { name: full.projectName }));
    } catch (err) {
      toast.error(t('newProject.failed', { detail: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const text = (key: 'projectName' | 'description' | 'author' | 'organization' | 'siteName' | 'siteAddress' | 'buildingName' | 'buildingLongName', label: string) => (
    <Field label={label}>
      <input aria-label={label} className={INPUT} value={spec[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[640px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('newProject.title')}</DialogTitle>
        </DialogHeader>
        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('newProject.project')}</h4>
          <div className="grid grid-cols-2 gap-2">
            {text('projectName', t('newProject.name'))}
            {text('description', t('newProject.description'))}
            {text('author', t('newProject.author'))}
            {text('organization', t('newProject.organization'))}
          </div>
        </section>
        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('newProject.site')}</h4>
          <div className="grid grid-cols-2 gap-2">
            {text('siteName', t('newProject.name'))}
            {text('siteAddress', t('newProject.address'))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('newProject.latitude')}><input aria-label={t('newProject.latitude')} inputMode="decimal" className={INPUT} value={geo.lat} placeholder="46.7704" onChange={(e) => setGeo((g) => ({ ...g, lat: e.target.value }))} /></Field>
            <Field label={t('newProject.longitude')}><input aria-label={t('newProject.longitude')} inputMode="decimal" className={INPUT} value={geo.lon} placeholder="23.5914" onChange={(e) => setGeo((g) => ({ ...g, lon: e.target.value }))} /></Field>
            <Field label={t('newProject.siteElevation')}><input aria-label={t('newProject.siteElevation')} inputMode="decimal" className={INPUT} value={geo.elev} onChange={(e) => setGeo((g) => ({ ...g, elev: e.target.value }))} /></Field>
          </div>
        </section>
        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('newProject.building')}</h4>
          <div className="grid grid-cols-2 gap-2">
            {text('buildingName', t('newProject.name'))}
            {text('buildingLongName', t('newProject.longName'))}
          </div>
        </section>
        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('newProject.levels')}</h4>
          <div className="flex items-end gap-2">
            <Field label={t('newProject.above')}><input aria-label={t('newProject.above')} className={INPUT} inputMode="numeric" value={gen.above} onChange={(e) => setGen((g) => ({ ...g, above: e.target.value }))} /></Field>
            <Field label={t('newProject.below')}><input aria-label={t('newProject.below')} className={INPUT} inputMode="numeric" value={gen.below} onChange={(e) => setGen((g) => ({ ...g, below: e.target.value }))} /></Field>
            <Field label={t('newProject.floorHeight')}><input aria-label={t('newProject.floorHeight')} className={INPUT} inputMode="decimal" value={gen.height} onChange={(e) => setGen((g) => ({ ...g, height: e.target.value }))} /></Field>
            <Button variant="outline" size="sm" onClick={() => set('levels', generateLevels(Math.round(Number(gen.above) || 0), Math.round(Number(gen.below) || 0), Number(gen.height.replace(',', '.')) || 3))}>
              {t('newProject.generate')}
            </Button>
          </div>
          {spec.levels.map((level, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={t('newProject.levelName')} className={INPUT} value={level.name} onChange={(e) => set('levels', spec.levels.map((l, j) => (j === i ? { ...l, name: e.target.value } : l)))} />
              <input aria-label={t('newProject.levelElevation')} className={`${INPUT} w-28`} inputMode="decimal" value={String(level.elevation)} onChange={(e) => set('levels', spec.levels.map((l, j) => (j === i ? { ...l, elevation: Number(e.target.value.replace(',', '.')) } : l)))} />
              <IconButton label={t('newProject.removeLevel')} className="size-7" onClick={() => set('levels', spec.levels.filter((_, j) => j !== i))}><X className="size-3.5" /></IconButton>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => set('levels', [...spec.levels, { name: t('newProject.newLevelName'), elevation: (spec.levels[0]?.elevation ?? 0) + 3 }])}>
            <Plus className="size-3.5 mr-1" />{t('newProject.addLevel')}
          </Button>
        </section>
        <section className="grid grid-cols-2 gap-2">
          <Field label={t('newProject.units')}>
            <select aria-label={t('newProject.units')} className={INPUT} value={spec.lengthUnit} onChange={(e) => set('lengthUnit', e.target.value === 'MILLIMETRE' ? 'MILLIMETRE' : 'METRE')}>
              <option value="METRE">{t('newProject.metres')}</option>
              <option value="MILLIMETRE">{t('newProject.millimetres')}</option>
            </select>
          </Field>
          <Field label={t('newProject.schema')}>
            <select aria-label={t('newProject.schema')} className={INPUT} value={spec.schema} onChange={(e) => set('schema', e.target.value as NewProjectSpec['schema'])}>
              {SCHEMAS.map((schema) => <option key={schema} value={schema}>{schema}</option>)}
            </select>
          </Field>
        </section>
        {problems.length > 0 ? <p role="alert" className="text-sm text-destructive">{t('newProject.incomplete')}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t('projectNavigator.dialog.cancel')}</Button>
          <Button disabled={problems.length > 0 || busy} onClick={() => { void create(); }}>{t('newProject.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
