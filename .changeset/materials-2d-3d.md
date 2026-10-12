---
"@ifc-lite/viewer": minor
"@ifc-lite/create": minor
---

One material for 2D and 3D. Building materials have a surface colour (their colour in 3D) and graphics per kind of view: Section, Top view (plans) and Front view (elevation surfaces), each with hatch, scale, fill and pen.

- Values come from the project's row, else from the IFC file's material styles (IfcMaterialDefinitionRepresentation: IfcSurfaceStyle colour, IfcFillAreaStyle hatches), else from the material's name.
- Apply to models, or closing the dialog, writes the colour and hatches into the editable IFC models, so 3D and the exported IFC follow. Element types write their layers' materials the same way.
- Plans and sections now also hatch elements made of a single material, not only layered ones.
- Re-meshing picks up material colours set during the session.

`@ifc-lite/create` adds `readMaterialAppearance`, `writeMaterialAppearance`, `emitMaterialAppearance`, `materialsNamed`, `elementsWithMaterials` and `materialIdsByElement`. Catalogue type layers can carry a full `appearance`.
