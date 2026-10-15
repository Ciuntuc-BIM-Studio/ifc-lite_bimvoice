/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A native model as Arrow IPC tables (N1, docs/format-lapin-nativ.md): one
 * table per element class plus storeys, types, materials, relations and
 * properties, and a JSON manifest. Scalars and coordinates are typed columns
 * (Float64, Utf8, Bool) a reader takes straight into columns; nested values
 * (outlines, sections, end cuts, joinery specs) are JSON columns.
 *
 * `nativeTablesFromModel` and `nativeModelFromTables` are inverse: what is
 * written reads back equal.
 */

import * as arrowModule from 'apache-arrow';
import type { NativeElement, NativeKind, NativeModel } from '@ifc-lite/create';

export { nativeTablesFolder } from './native-tables-path';

/**
 * The slice of apache-arrow this module uses. The viewer declares the package
 * as `any` (`src/apache-arrow.d.ts`, an export-conditions workaround), so the
 * shape is stated here once.
 */
export interface ArrowVector { get(index: number): unknown; toArray(): unknown }
export interface ArrowTable {
  numRows: number;
  getChild(name: string): ArrowVector | null;
  schema: { fields: { name: string; type: unknown }[] };
}
interface ArrowApi {
  Table: new (vectors: Record<string, unknown>) => ArrowTable;
  Float64: new () => unknown;
  Utf8: new () => unknown;
  Bool: new () => unknown;
  vectorFromArray(values: unknown[], type: unknown): unknown;
  tableToIPC(table: ArrowTable, format: 'file'): Uint8Array;
  tableFromIPC(bytes: Uint8Array): ArrowTable;
}
const arrow = arrowModule as unknown as ArrowApi;

/** One native table, read (for inspection and tests). */
export const readNativeTable = (bytes: Uint8Array): ArrowTable => arrow.tableFromIPC(bytes);

type Kind = 'f64' | 'utf8' | 'bool' | 'json';
type Row = Record<string, unknown>;

/** One column: the element field (or a point's component) it holds. */
interface Column { name: string; kind: Kind; field: string; index?: number }

const BASE: Column[] = [
  { name: 'id', kind: 'utf8', field: 'id' },
  { name: 'storeyId', kind: 'utf8', field: 'storeyId' },
  { name: 'typeId', kind: 'utf8', field: 'typeId' },
  { name: 'predefinedType', kind: 'utf8', field: 'predefinedType' },
  { name: 'name', kind: 'utf8', field: 'name' },
  { name: 'description', kind: 'utf8', field: 'description' },
  { name: 'objectType', kind: 'utf8', field: 'objectType' },
  { name: 'tag', kind: 'utf8', field: 'tag' },
];
const point = (field: string, dims: number): Column[] =>
  ['x', 'y', 'z'].slice(0, dims).map((axis, index) => ({ name: `${field}_${axis}`, kind: 'f64' as const, field, index }));
const f64 = (...fields: string[]): Column[] => fields.map((field) => ({ name: field, kind: 'f64' as const, field }));
const json = (...fields: string[]): Column[] => fields.map((field) => ({ name: field, kind: 'json' as const, field }));
const bool = (...fields: string[]): Column[] => fields.map((field) => ({ name: field, kind: 'bool' as const, field }));
const utf8 = (...fields: string[]): Column[] => fields.map((field) => ({ name: field, kind: 'utf8' as const, field }));

/** The columns of each class's table, after BASE. */
const ELEMENT_COLUMNS: Record<NativeKind, Column[]> = {
  wall: [...point('start', 2), ...point('end', 2), ...f64('baseOffset', 'height', 'thickness', 'offset'), ...utf8('alignment'), ...json('startCut', 'endCut', 'timberFrame', 'roofTrim'), ...bool('flipLayers')],
  slab: [...json('outline', 'holes'), ...f64('topOffset', 'thickness')],
  beam: [...point('start', 3), ...point('end', 3), ...json('section'), ...f64('rotation')],
  column: [...point('position', 3), ...f64('height', 'rotation'), ...json('section')],
  opening: [...utf8('host', 'hostId'), ...f64('along', 'sill', 'width', 'height', 'depth', 'rotation'), ...json('center')],
  door: [...utf8('hostId'), ...f64('along', 'sill'), ...bool('flipFacing', 'flipHand')],
  window: [...utf8('hostId'), ...f64('along', 'sill'), ...bool('flipFacing', 'flipHand')],
  solid: [...utf8('ifcClass'), ...json('shape')],
  system: [...utf8('family', 'ifcClass'), ...json('spec')],
};

const ARROW: Record<Kind, () => unknown> = { f64: () => new arrow.Float64(), utf8: () => new arrow.Utf8(), bool: () => new arrow.Bool(), json: () => new arrow.Utf8() };

function cell(row: Row, column: Column): unknown {
  const value = row[column.field];
  if (value === undefined || value === null) return null;
  if (column.index !== undefined) return (value as number[])[column.index] ?? null;
  return column.kind === 'json' ? JSON.stringify(value) : value;
}

function toTable(rows: readonly Row[], columns: readonly Column[]): Uint8Array {
  const vectors = Object.fromEntries(columns.map((c) => [c.name, arrow.vectorFromArray(rows.map((r) => cell(r, c)), ARROW[c.kind]())]));
  return arrow.tableToIPC(new arrow.Table(vectors), 'file');
}

function fromTable(bytes: Uint8Array, columns: readonly Column[]): Row[] {
  const table = arrow.tableFromIPC(bytes);
  const rows: Row[] = Array.from({ length: table.numRows }, () => ({}));
  for (const column of columns) {
    const vector = table.getChild(column.name);
    if (!vector) continue;
    for (let i = 0; i < table.numRows; i++) {
      const value: unknown = vector.get(i);
      if (value === null || value === undefined) continue;
      const row = rows[i];
      if (column.index !== undefined) {
        const target = (row[column.field] ??= []) as number[];
        target[column.index] = value as number;
      } else {
        row[column.field] = column.kind === 'json' ? JSON.parse(value as string) : value;
      }
    }
  }
  return rows;
}

/** Records that are not elements are stored whole, one JSON column per field the record family uses. */
const recordColumns = (...fields: string[]): Column[] => fields.map((field) => ({ name: field, kind: 'json' as const, field }));
const STOREYS = [...utf8('id', 'name'), ...f64('elevation')];
const TYPES = recordColumns('id', 'kind', 'name', 'mark', 'layers', 'height', 'section', 'materialId', 'predefinedType', 'spec');
const MATERIALS = [...utf8('id', 'name', 'category', 'color'), ...f64('transparency')];
const RELATIONS = recordColumns('kind', 'a', 'b', 'style', 'through', 'whole', 'parts', 'group', 'name', 'members');
const PROPERTIES = [...utf8('elementId', 'pset', 'name', 'ifcType'), ...json('value')];

export interface NativeTablesManifest {
  schemaVersion: number;
  id: string;
  name: string;
  /** Rows per table, by path inside the native folder. */
  tables: Record<string, number>;
}

/** The files of a native model, by path inside its native folder. */
export function nativeTablesFromModel(model: NativeModel): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const tables: Record<string, number> = {};
  const put = (path: string, rows: readonly Row[], columns: readonly Column[]) => {
    files.set(path, toTable(rows, columns));
    tables[path] = rows.length;
  };
  const byKind = new Map<NativeKind, NativeElement[]>();
  for (const element of model.elements) {
    const list = byKind.get(element.kind) ?? [];
    list.push(element);
    byKind.set(element.kind, list);
  }
  for (const [kind, elements] of byKind) put(`elements/${kind}.arrow`, elements as unknown as Row[], [...BASE, ...ELEMENT_COLUMNS[kind]]);
  put('storeys.arrow', model.storeys as unknown as Row[], STOREYS);
  put('types.arrow', model.types as unknown as Row[], TYPES);
  put('materials.arrow', model.materials as unknown as Row[], MATERIALS);
  put('relations.arrow', model.relations as unknown as Row[], RELATIONS);
  put('properties.arrow', model.properties as unknown as Row[], PROPERTIES);
  const manifest: NativeTablesManifest = { schemaVersion: model.schemaVersion, id: model.id, name: model.name, tables };
  files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  return files;
}

/** Read a native model back from its files (paths inside its native folder). */
export function nativeModelFromTables(files: ReadonlyMap<string, Uint8Array>): NativeModel {
  const raw = files.get('manifest.json');
  if (!raw) throw new Error('native tables: no manifest.json');
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as NativeTablesManifest;
  const read = <T>(path: string, columns: readonly Column[]): T[] => {
    const bytes = files.get(path);
    return bytes ? (fromTable(bytes, columns) as unknown as T[]) : [];
  };
  const elements: NativeElement[] = [];
  for (const kind of Object.keys(ELEMENT_COLUMNS) as NativeKind[]) {
    for (const row of read<Row>(`elements/${kind}.arrow`, [...BASE, ...ELEMENT_COLUMNS[kind]])) {
      elements.push({ ...row, kind } as unknown as NativeElement);
    }
  }
  return {
    schemaVersion: manifest.schemaVersion, id: manifest.id, name: manifest.name,
    storeys: read('storeys.arrow', STOREYS), elements,
    types: read('types.arrow', TYPES), materials: read('materials.arrow', MATERIALS),
    relations: read('relations.arrow', RELATIONS), properties: read('properties.arrow', PROPERTIES),
  };
}
