/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What an IFC exported from a native model promises (N6), as an IDS 1.0
 * document any IDS checker reads: every element that says it is native
 * (`Pset_LapinNative.Class`) carries its schema version and parameters, the
 * base quantities its class always gets (`export-sets.ts`), and a GlobalId.
 * Built from the class table (`ifc-mapping.ts`), so a class added there is
 * checked here.
 */

import { NATIVE_IFC, NATIVE_PSET } from './ifc-mapping.js';
import type { NativeKind } from './schema.js';

/** The quantities `nativeQuantities` writes for a class whenever it writes the set. */
const ALWAYS: Record<NativeKind, readonly string[]> = {
  wall: ['Length', 'Width', 'Height', 'GrossSideArea', 'NetSideArea', 'GrossVolume', 'NetVolume'],
  slab: ['Depth', 'Perimeter', 'GrossArea', 'NetArea', 'GrossVolume', 'NetVolume'],
  beam: ['Length'],
  column: ['Length'],
  opening: ['Width'],
  door: ['Width', 'Height', 'Area'],
  window: ['Width', 'Height', 'Area'],
  // Its quantity set depends on the class it is written as.
  solid: [],
};

const value = (v: string) => `<simpleValue>${v}</simpleValue>`;
const property = (set: string, name: string, cardinality: 'required' | null, exact?: string) =>
  `<property${cardinality ? ` cardinality="${cardinality}"` : ''}><propertySet>${value(set)}</propertySet><baseName>${value(name)}</baseName>${exact ? `<value>${value(exact)}</value>` : ''}</property>`;

function specification(kind: NativeKind): string {
  const { ifcClass, quantitySet } = NATIVE_IFC[kind];
  const requirements = [
    `<attribute cardinality="required"><name>${value('GlobalId')}</name></attribute>`,
    property(NATIVE_PSET, 'SchemaVersion', 'required'),
    property(NATIVE_PSET, 'Parameters', 'required'),
    ...(quantitySet ? ALWAYS[kind].map((q) => property(quantitySet, q, 'required')) : []),
  ];
  // A Studio solid is written as any class (`nativeIfcClass`): it applies by its Class alone.
  const entity = kind === 'solid' ? '' : `<entity><name>${value(ifcClass.toUpperCase())}</name></entity>`;
  return `<specification name="Lapin native ${kind}" ifcVersion="IFC2X3 IFC4 IFC4X3_ADD2">`
    + `<applicability minOccurs="0" maxOccurs="unbounded">${entity}${property(NATIVE_PSET, 'Class', null, kind)}</applicability>`
    + `<requirements>${requirements.join('')}</requirements></specification>`;
}

/** The IDS document a native model's IFC export is checked against. */
export function nativeExportIds(): string {
  const kinds = Object.keys(NATIVE_IFC) as NativeKind[];
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema" '
    + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    + 'xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">'
    + '<info><title>Lapin native export</title><description>What an IFC exported from a Lapin native model carries.</description></info>'
    + `<specifications>${kinds.map(specification).join('')}</specifications></ids>`;
}
