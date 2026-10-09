---
"@ifc-lite/drawing-2d": minor
"@ifc-lite/viewer": minor
---

Building materials (ArchiCAD style): cut polygons now carry the layer's `materialId` (from `MeshData.materialId`), and the viewer's project gets a materials table (Design › Materials) — per IfcMaterial a cut hatch with scale and pen, a fill (IFC colour, none, or own) and a membrane flag, with defaults guessed from the material's name. Plans and sections hatch each wall / slab layer by its material on screen, on sheets and in DXF; where two elements' bands of one material meet the line between them goes, so insulation runs on round a corner; layers under 2 mm (which the geometry engine does not cut into a band) and materials marked as membranes draw as a heavy dashed line where they lie. A category's own cut hatch still wins.
