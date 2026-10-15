/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Project location (Project settings): the coordinate system, a point of the
 * model with its surveyed coordinates (typed, or picked in a plan with
 * LOCATION), and the rotation as an angle or from a second surveyed point.
 * The coordinate system is picked by country and zone (`project-location-crs.ts`)
 * or by EPSG code, and the coordinates are asked for as surveys there write
 * them: X north and Y east in Romania and Austria, north first in Romania. Apply writes the IfcProjectedCRS and IfcMapConversion of every model
 * the user may edit (`project-location-store.ts`), then the site's latitude,
 * longitude and true north (`project-location-geo.ts`).
 */

import { useEffect, useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { conversionRotation, localToMap, solveLocation, type LocationRotation, type Vec3 } from '@/project/project-location';
import { COUNTRIES, countryOf, customCrs, STEREO_70, surveyedEasting, type CountryId } from '@/project/project-location-crs';
import {
  applyProjectLocation, closeProjectLocation, locationModels, pickLocationPoint, readProjectLocation, useProjectLocationDialog, type LocationDraft,
} from '@/project/project-location-store';
import { geolocateProject } from '@/project/project-location-geo';

const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));
const vec = (v: readonly string[]): Vec3 => [num(v[0] ?? ''), num(v[1] ?? ''), num(v[2] ?? '0')];
const text = (v: number) => String(Math.round(v * 1000) / 1000);

/** The form for the location the models carry now (its base point at the origin), or a blank Stereo 70 one. */
function initialDraft(): LocationDraft {
  const now = readProjectLocation();
  const conversion = now?.conversion;
  const map = conversion ? localToMap(conversion, [0, 0, 0]).map(text) : ['', '', ''];
  return {
    crs: now?.crs ?? STEREO_70,
    base: { local: ['0', '0', '0'], map },
    rotation: 'angle',
    angle: conversion ? text(conversionRotation(conversion)) : '0',
    second: { local: ['', ''], map: ['', ''] },
  };
}

interface CoordProps {
  label: string;
  value: string;
  onChange(v: string): void;
}

function Coord({ label, value, onChange }: CoordProps) {
  return (
    <Field label={label} labelClassName="text-xs font-normal text-muted-foreground">
      <Input inputMode="decimal" className="h-8 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function ProjectLocationDialog() {
  const { t } = useTranslation();
  const open = useProjectLocationDialog((s) => s.open);
  const draft = useProjectLocationDialog((s) => s.draft);
  useEffect(() => {
    if (open && !draft) useProjectLocationDialog.setState({ draft: initialDraft() });
  }, [open, draft]);
  const set = (patch: Partial<LocationDraft>) => useProjectLocationDialog.setState((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s));

  const solution = useMemo(() => {
    if (!draft) return null;
    const rotation: LocationRotation = draft.rotation === 'angle'
      ? { kind: 'angle', degrees: num(draft.angle) }
      : { kind: 'point', point: { local: vec(draft.second.local), map: [surveyedEasting(draft.crs, num(draft.second.map[0])), num(draft.second.map[1]), 0] } };
    const base = vec(draft.base.map);
    return solveLocation({ local: vec(draft.base.local), map: [surveyedEasting(draft.crs, base[0]), base[1], base[2]] }, rotation);
  }, [draft]);
  const models = useMemo(() => (open ? locationModels().length : 0), [open]);
  if (!draft) return null;

  const north = draft.crs.northFirst;
  const xy = draft.crs.xyLabels;
  const { country, zone } = countryOf(draft.crs);
  const zones = COUNTRIES.find((c) => c.id === country)?.zones ?? [];
  const pickCountry = (id: CountryId) => set({ crs: id === 'other' ? customCrs('') : COUNTRIES.find((c) => c.id === id)!.zones[0] });
  const crsOk = draft.crs.name.trim() !== '';
  const solved = solution && 'eastings' in solution ? solution : null;
  const pick = (which: 'base' | 'second') => {
    if (!pickLocationPoint(which, draft)) toast.info(t('location.pickNeedsPlan'));
  };
  const apply = () => {
    if (!solved || !crsOk) return;
    const count = applyProjectLocation(draft.crs, solved);
    toast.success(t('location.applied', { count }));
    // The site's latitude, longitude and true north follow once the projection is resolved.
    void geolocateProject(locationModels(), draft.crs, solved).then((n) => { if (n === 0 && count > 0) toast.info(t('location.noGeo')); });
    closeProjectLocation();
  };

  /** The surveyed E, N (and H) of a point, in the order the CRS's surveyors give them. */
  const surveyed = (which: 'base' | 'second') => {
    const map = draft[which].map;
    const setAt = (i: number, v: string) => set({ [which]: { ...draft[which], map: map.map((m, k) => (k === i ? v : m)) } });
    const east = <Coord key="e" label={t(xy ? 'location.east' : 'location.easting')} value={map[0] ?? ''} onChange={(v) => setAt(0, v)} />;
    const northing = <Coord key="n" label={t(xy ? 'location.north' : 'location.northing')} value={map[1] ?? ''} onChange={(v) => setAt(1, v)} />;
    return (
      <div className="grid grid-cols-3 gap-2">
        {north ? [northing, east] : [east, northing]}
        {which === 'base' && <Coord label={t('location.height')} value={map[2] ?? ''} onChange={(v) => setAt(2, v)} />}
      </div>
    );
  };
  const modelPoint = (which: 'base' | 'second') => {
    const local = draft[which].local;
    const setAt = (i: number, v: string) => set({ [which]: { ...draft[which], local: local.map((m, k) => (k === i ? v : m)) } });
    return (
      <div className="grid grid-cols-3 gap-2">
        <Coord label={t('location.x')} value={local[0] ?? ''} onChange={(v) => setAt(0, v)} />
        <Coord label={t('location.y')} value={local[1] ?? ''} onChange={(v) => setAt(1, v)} />
        {which === 'base' && <Coord label={t('location.z')} value={local[2] ?? ''} onChange={(v) => setAt(2, v)} />}
      </div>
    );
  };
  const point = (which: 'base' | 'second') => (
    <section className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t(which === 'base' ? 'location.base' : 'location.second')}</h3>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => pick(which)}>
          <MapPin className="h-3.5 w-3.5" aria-hidden />{t('location.pick')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('location.model')}{which === 'base' ? ` ${t('location.modelHint')}` : ''}</p>
      {modelPoint(which)}
      <p className="text-xs text-muted-foreground">{t('location.survey')}</p>
      {surveyed(which)}
    </section>
  );

  const problem = solution && 'problem' in solution ? solution.problem : null;
  // Leaving for a plan pick moves the focus out after the dialog let go: only a close of the open dialog drops the form.
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && useProjectLocationDialog.getState().open) closeProjectLocation(); }}>
      <DialogContent className="sm:max-w-[600px] max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('location.title')}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">{t('location.intro')}</p>
          <div className="grid grid-cols-[2fr_3fr] gap-2">
            <Field label={t('location.country')} labelClassName="text-xs">
              <Select value={country} onValueChange={(v) => pickCountry(v as CountryId)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...COUNTRIES.map((c) => c.id), 'other' as const].map((id) => (
                    <SelectItem key={id} value={id}>{t(`location.country.${id}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {country === 'other'
              ? (
                <Field label={t('location.crs.code')} labelClassName="text-xs">
                  <Input className="h-8 font-mono text-xs" value={draft.crs.name} onChange={(e) => set({ crs: customCrs(e.target.value.trim().toUpperCase(), draft.crs.verticalDatum) })} />
                </Field>
              )
              : (
                <Field label={t('location.crs')} labelClassName="text-xs">
                  <Select value={String(zone)} disabled={zones.length < 2} onValueChange={(v) => set({ crs: zones[Number(v)] })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {zones.map((z, k) => <SelectItem key={z.name} value={String(k)}>{z.description} ({z.name})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
          </div>
          {country === 'other'
            ? (
              <Field label={t('location.crs.vertical')} hint={t('location.crs.codeHint')} labelClassName="text-xs">
                <Input className="h-8 w-48 font-mono text-xs" value={draft.crs.verticalDatum ?? ''} onChange={(e) => set({ crs: customCrs(draft.crs.name, e.target.value.trim().toUpperCase() || undefined) })} />
              </Field>
            )
            : <p className="text-xs text-muted-foreground">{t(`location.hint.${country}`, { height: draft.crs.verticalDatum ?? '' })}</p>}
          {point('base')}
          <SegmentedControl
            label={t('location.rotation')}
            size="sm"
            value={draft.rotation}
            options={[{ value: 'angle', label: t('location.rotation.angle') }, { value: 'point', label: t('location.rotation.point') }]}
            onValueChange={(v) => set({ rotation: v })}
          />
          {draft.rotation === 'angle'
            ? (
              <Field label={t('location.angle')} hint={t('location.angleHint')} labelClassName="text-xs">
                <Input inputMode="decimal" className="h-8 w-32 font-mono text-xs" value={draft.angle} onChange={(e) => set({ angle: e.target.value })} />
              </Field>
            )
            : point('second')}
          <div className="rounded-md bg-muted/50 p-2 text-xs" aria-live="polite">
            {solved
              ? <p>{t('location.summary', { height: text(solved.orthogonalHeight), angle: text(solved.rotation) })}</p>
              : problem && <p>{t(problem === 'samePoint' ? 'location.problem.samePoint' : 'location.problem.notFinite')}</p>}
            {solved?.misfit !== undefined && Math.abs(solved.misfit) > 0.005 && (
              <p className="text-amber-600 dark:text-amber-400">{t('location.misfit', { mm: Math.round(solved.misfit * 1000) })}</p>
            )}
            <p className="text-muted-foreground">{models > 0 ? t('location.models', { count: models }) : t('location.noModels')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={closeProjectLocation}>{t('location.cancel')}</Button>
          <Button onClick={apply} disabled={!solved || !crsOk || models === 0}>{t('location.apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
