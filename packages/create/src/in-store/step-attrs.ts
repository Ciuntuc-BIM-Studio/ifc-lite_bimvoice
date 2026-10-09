/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The bridge from the from-scratch emitters (`ifc-creator-*.ts`, which
 * write STEP attribute text through an `emit(type, attrs)` hook) to a
 * `StoreEditor`: the text is parsed into the editor's attribute values —
 * `'…'` strings, `#n` references, `$`, `.ENUM.`, reals (with a decimal
 * point) and integers, `IFCTYPE(value)` typed markers, nested lists — so
 * the alignment emitter writes into a loaded model as it does into a new file.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import type { SchemaRegistry } from '@ifc-lite/parser';
import { canonicalEntity } from './schema-attributes.js';

type Attr = Parameters<StoreEditor['addEntity']>[1][number];

export function parseStepAttributes(text: string): Attr[] {
  let i = 0;
  const peek = () => text[i];
  const skip = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const value = (): Attr => {
    skip();
    const c = peek();
    if (c === '(') {
      i++;
      const list: Attr[] = [];
      skip();
      if (peek() === ')') { i++; return list; }
      for (;;) {
        list.push(value());
        skip();
        if (peek() === ',') { i++; continue; }
        if (peek() === ')') { i++; return list; }
        throw new Error(`parseStepAttributes: expected , or ) at ${i} in ${text}`);
      }
    }
    if (c === "'") {
      i++;
      let s = '';
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") { s += "'"; i += 2; continue; }
          i++;
          return s.replace(/\\\\/g, '\\');
        }
        s += text[i++];
      }
      throw new Error(`parseStepAttributes: unterminated string in ${text}`);
    }
    if (c === '$') { i++; return null; }
    if (c === '*') { i++; return null; }
    if (c === '#') {
      const m = /^#\d+/.exec(text.slice(i))!;
      i += m[0].length;
      return m[0];
    }
    if (c === '.') {
      const m = /^\.[A-Z0-9_]+\./.exec(text.slice(i));
      if (!m) throw new Error(`parseStepAttributes: bad enumeration at ${i} in ${text}`);
      i += m[0].length;
      return m[0];
    }
    const num = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
    if (num) {
      i += num[0].length;
      const real = num[0].includes('.') || /[eE]/.test(num[0]);
      return real ? { real: Number(num[0]) } : Number(num[0]);
    }
    const typed = /^([A-Za-z_][A-Za-z0-9_]*)\(/.exec(text.slice(i));
    if (typed) {
      i += typed[0].length;
      const inner = value();
      skip();
      if (peek() !== ')') throw new Error(`parseStepAttributes: expected ) after typed value at ${i} in ${text}`);
      i++;
      const raw = inner && typeof inner === 'object' && 'real' in inner ? (inner as { real: number }).real : inner;
      const v = typeof raw === 'string' && /^\.[TFU]\.$/.test(raw) ? raw === '.T.' : raw;
      return { typed: { type: canonicalTypeName(typed[1].toUpperCase()), value: v as string | number | boolean } };
    }
    throw new Error(`parseStepAttributes: unexpected "${c}" at ${i} in ${text}`);
  };
  const out: Attr[] = [];
  skip();
  if (i >= text.length) return out;
  for (;;) {
    out.push(value());
    skip();
    if (peek() === ',') { i++; continue; }
    if (i >= text.length) return out;
    throw new Error(`parseStepAttributes: trailing "${text.slice(i)}"`);
  }
}

/** IFCLENGTHMEASURE → IfcLengthMeasure (the serializer upper-cases it again; the casing only reads better in the overlay). */
function canonicalTypeName(upper: string): string {
  const known: Record<string, string> = {
    IFCLENGTHMEASURE: 'IfcLengthMeasure', IFCBOOLEAN: 'IfcBoolean', IFCLABEL: 'IfcLabel', IFCTEXT: 'IfcText', IFCREAL: 'IfcReal',
    IFCIDENTIFIER: 'IfcIdentifier', IFCPLANEANGLEMEASURE: 'IfcPlaneAngleMeasure', IFCPOSITIVELENGTHMEASURE: 'IfcPositiveLengthMeasure', IFCINTEGER: 'IfcInteger',
  };
  return known[upper] ?? upper;
}

/** An `emit` hook over a StoreEditor: types resolved to the schema's canonical spelling. */
export function storeEmitter(editor: StoreEditor, registry: SchemaRegistry, op: string): (type: string, attrs: string) => number {
  return (type, attrs) => {
    const canonical = canonicalEntity(registry, type);
    if (!canonical) throw new Error(`${op}: ${type} does not exist in ${registry.name}`);
    return editor.addEntity(canonical, parseStepAttributes(attrs)).expressId;
  };
}
