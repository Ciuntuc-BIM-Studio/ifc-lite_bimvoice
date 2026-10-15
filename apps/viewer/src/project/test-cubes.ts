/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A stress-test model: `count` boxes of random size on a square grid, each
 * an IfcBuildingElementProxy with its own GlobalId and its base quantities
 * (Qto_BuildingElementProxyQuantities: FootprintArea, NetSurfaceArea,
 * NetVolume).
 *
 * Sizes come in 5 cm steps, so boxes of one size share their shape and
 * their quantity set: the meshes are instanced on the GPU and the file stays
 * near 200 bytes a box. Written as IFC bytes in chunks (a million boxes is
 * past what one string may hold), yielding between chunks.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';

export interface TestCubesOptions {
  /** The smallest and largest side, metres. */
  minSide?: number;
  maxSide?: number;
  /** Grid spacing, metres (larger than the largest side). */
  spacing?: number;
  onProgress?: (done: number) => void;
}

const STEP = 0.05;
const CHUNK = 20_000;
const fmt = (v: number) => (Number.isInteger(v) ? `${v}.` : String(Number(v.toFixed(6))));

/** The quantities of a box `x` by `y` by `z`: its footprint, its surface and its volume. */
export function boxQuantities(x: number, y: number, z: number): { footprint: number; surface: number; volume: number } {
  return { footprint: x * y, surface: 2 * (x * y + x * z + y * z), volume: x * y * z };
}

export async function testCubesIfc(count: number, options: TestCubesOptions = {}): Promise<Blob> {
  const minSide = options.minSide ?? 0.3;
  const maxSide = options.maxSide ?? 1.5;
  const spacing = options.spacing ?? Math.ceil(maxSide + 0.5);
  const steps = Math.round((maxSide - minSide) / STEP) + 1;
  const side = (i: number) => Number((minSide + i * STEP).toFixed(2));
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const guid = () => generateIfcGuid();

  parts.push(encoder.encode([
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME('test-cubes.ifc','${new Date().toISOString().slice(0, 19)}',(''),(''),'Lapin','Lapin','');`,
    "FILE_SCHEMA(('IFC4X3_ADD2'));",
    'ENDSEC;',
    'DATA;',
    '#1=IFCDIRECTION((1.,0.,0.));',
    '#2=IFCDIRECTION((0.,0.,1.));',
    '#3=IFCCARTESIANPOINT((0.,0.,0.));',
    '#4=IFCAXIS2PLACEMENT3D(#3,#2,#1);',
    "#5=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#4,$);",
    "#6=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#5,$,.MODEL_VIEW.,$);",
    '#7=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);',
    '#8=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);',
    '#9=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);',
    '#10=IFCUNITASSIGNMENT((#7,#8,#9));',
    `#11=IFCPROJECT('${guid()}',$,'Test cubes',$,$,$,$,(#5),#10);`,
    '#12=IFCLOCALPLACEMENT($,#4);',
    `#13=IFCSITE('${guid()}',$,'Site',$,$,#12,$,$,.ELEMENT.,$,$,$,$,$);`,
    '#14=IFCLOCALPLACEMENT(#12,#4);',
    `#15=IFCBUILDING('${guid()}',$,'Building',$,$,#14,$,$,.ELEMENT.,$,$,$);`,
    '#16=IFCLOCALPLACEMENT(#14,#4);',
    `#17=IFCBUILDINGSTOREY('${guid()}',$,'Level 0',$,$,#16,$,$,.ELEMENT.,0.);`,
    `#18=IFCRELAGGREGATES('${guid()}',$,$,$,#11,(#13));`,
    `#19=IFCRELAGGREGATES('${guid()}',$,$,$,#13,(#15));`,
    `#20=IFCRELAGGREGATES('${guid()}',$,$,$,#15,(#17));`,
    '#21=IFCAXIS2PLACEMENT2D(#3,$);',
    '',
  ].join('\n')));

  // A shape and a quantity set for every size a box can have, made when first needed.
  let next = 100;
  const sizes = new Map<number, { shape: number; qto: number; members: number[] }>();
  const sizeOf = (ix: number, iy: number, iz: number, lines: string[]) => {
    const key = (ix * steps + iy) * steps + iz;
    let size = sizes.get(key);
    if (size) return size;
    const [x, y, z] = [side(ix), side(iy), side(iz)];
    const q = boxQuantities(x, y, z);
    const id = next;
    next += 9;
    lines.push(
      `#${id}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#21,${fmt(x)},${fmt(y)});`,
      `#${id + 1}=IFCEXTRUDEDAREASOLID(#${id},$,#2,${fmt(z)});`,
      `#${id + 2}=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#${id + 1}));`,
      `#${id + 3}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${id + 2}));`,
      `#${id + 4}=IFCQUANTITYAREA('FootprintArea',$,#8,${fmt(q.footprint)},$);`,
      `#${id + 5}=IFCQUANTITYAREA('NetSurfaceArea',$,#8,${fmt(q.surface)},$);`,
      `#${id + 6}=IFCQUANTITYVOLUME('NetVolume',$,#9,${fmt(q.volume)},$);`,
      `#${id + 7}=IFCELEMENTQUANTITY('${guid()}',$,'Qto_BuildingElementProxyQuantities',$,$,(#${id + 4},#${id + 5},#${id + 6}));`,
    );
    // #id+8 is kept for the size's IfcRelDefinesByProperties, written once its members are known.
    size = { shape: id + 3, qto: id + 7, members: [] };
    sizes.set(key, size);
    return size;
  };

  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const random = () => Math.floor(Math.random() * steps);
  const products: number[] = [];
  for (let start = 0; start < count; start += CHUNK) {
    const lines: string[] = [];
    for (let i = start; i < Math.min(count, start + CHUNK); i++) {
      const size = sizeOf(random(), random(), random(), lines);
      const id = next;
      next += 4;
      const x = (i % columns) * spacing, y = Math.floor(i / columns) * spacing;
      lines.push(
        `#${id}=IFCCARTESIANPOINT((${fmt(x)},${fmt(y)},0.));`,
        `#${id + 1}=IFCAXIS2PLACEMENT3D(#${id},$,$);`,
        `#${id + 2}=IFCLOCALPLACEMENT(#16,#${id + 1});`,
        `#${id + 3}=IFCBUILDINGELEMENTPROXY('${guid()}',$,'Cube ${String(i + 1).padStart(7, '0')}',$,$,#${id + 2},#${size.shape},$,.NOTDEFINED.);`,
      );
      size.members.push(id + 3);
      products.push(id + 3);
    }
    parts.push(encoder.encode(lines.join('\n') + '\n'));
    options.onProgress?.(Math.min(count, start + CHUNK));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const tail: string[] = [];
  for (const size of sizes.values()) {
    tail.push(`#${size.qto + 1}=IFCRELDEFINESBYPROPERTIES('${guid()}',$,$,$,(${size.members.map((m) => `#${m}`).join(',')}),#${size.qto});`);
  }
  parts.push(encoder.encode(tail.join('\n') + '\n'));
  parts.push(encoder.encode(`#${next}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',$,$,$,(${products.map((m) => `#${m}`).join(',')}),#17);\nENDSEC;\nEND-ISO-10303-21;\n`));
  return new Blob(parts as BlobPart[], { type: 'application/x-step' });
}
