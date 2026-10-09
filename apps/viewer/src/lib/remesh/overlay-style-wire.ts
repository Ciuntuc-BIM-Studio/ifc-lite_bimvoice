/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The colours this session's overlay gives geometry items: every live
 * IfcStyledItem it created, followed to its surface colour (IfcSurfaceStyle,
 * or IFC2X3's IfcPresentationStyleAssignment, → shading / rendering →
 * IfcColourRgb, its transparency as alpha), keyed by the styled item as the
 * engine's style wire is. The model's own wire is read once from the source
 * file, so without these an element authored in the session (a roof's
 * coloured planes and timber) re-meshes in its class's default colour.
 */

type Attrs = readonly unknown[];

export interface OverlayEntitySource {
  /** The overlay's created entities, deleted ones left out. */
  entities(): Iterable<{ expressId: number; type: string; attributes: Attrs }>;
  /** Any entity's attributes (created or from the source), with the session's edits. */
  attributes(id: number): Attrs | null;
}

const ref = (v: unknown): number | null => (typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : v && typeof v === 'object' && 'real' in v ? Number((v as { real: unknown }).real) : NaN;
  return Number.isFinite(n) ? n : null;
};
const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** RGBA (0–255) of a presentation style, or null when it carries no surface colour. */
function styleColour(src: OverlayEntitySource, id: number, depth = 0): [number, number, number, number] | null {
  if (depth > 4) return null;
  const a = src.attributes(id);
  if (!a) return null;
  // IfcPresentationStyleAssignment: [Styles]; IfcSurfaceStyle: [Name, Side, Styles].
  const list = Array.isArray(a[2]) ? a[2] : Array.isArray(a[0]) ? a[0] : null;
  if (list) {
    for (const s of list) {
      const next = ref(s);
      const c = next === null ? null : styleColour(src, next, depth + 1);
      if (c) return c;
    }
    return null;
  }
  // IfcSurfaceStyleShading / Rendering: [SurfaceColour, Transparency, …].
  const colourId = ref(a[0]);
  const rgb = colourId === null ? null : src.attributes(colourId);
  if (!rgb) return null;
  const [r, g, b] = [num(rgb[1]), num(rgb[2]), num(rgb[3])];
  if (r === null || g === null || b === null) return null;
  const transparency = num(a[1]) ?? 0;
  return [byte(r), byte(g), byte(b), byte(1 - transparency)];
}

/** The overlay's styled items as style wire entries (item id → RGBA). */
export function overlayStyleWire(src: OverlayEntitySource): { styleIds: Uint32Array; styleColors: Uint8Array } {
  const ids: number[] = [];
  const colors: number[] = [];
  for (const e of src.entities()) {
    if (e.type.toUpperCase() !== 'IFCSTYLEDITEM') continue;
    const item = ref(e.attributes[0]);
    const styles = Array.isArray(e.attributes[1]) ? e.attributes[1] : [];
    if (item === null) continue;
    for (const s of styles) {
      const id = ref(s);
      const c = id === null ? null : styleColour(src, id);
      if (!c) continue;
      ids.push(item);
      colors.push(...c);
      break;
    }
  }
  return { styleIds: Uint32Array.from(ids), styleColors: Uint8Array.from(colors) };
}

/** The model's wire with the overlay's entries after it (later entries win for the same item). */
export function withOverlayStyles(
  wire: { styleIds: Uint32Array; styleColors: Uint8Array },
  overlay: { styleIds: Uint32Array; styleColors: Uint8Array },
): { styleIds: Uint32Array; styleColors: Uint8Array } {
  if (overlay.styleIds.length === 0) return wire;
  const ids = new Uint32Array(wire.styleIds.length + overlay.styleIds.length);
  ids.set(wire.styleIds);
  ids.set(overlay.styleIds, wire.styleIds.length);
  const colors = new Uint8Array(wire.styleColors.length + overlay.styleColors.length);
  colors.set(wire.styleColors);
  colors.set(overlay.styleColors, wire.styleColors.length);
  return { styleIds: ids, styleColors: colors };
}
