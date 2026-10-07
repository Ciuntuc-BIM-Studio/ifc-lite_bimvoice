---
"@ifc-lite/viewer": minor
"@ifc-lite/create": minor
---

Pitched roofs. `roofFacets` / `roofSolidFaces` build a roof's surface and closed solid over a plan outline — flat, mono-pitch (any outline), gable and hip (rectangles) — and `addFacetedElementToStore` / `replaceFacetedGeometryInStore` write any IfcElement with an IfcFacetedBrep body in a loaded model. In the viewer, the Design tab's Roof (ROOF command) turns a closed contour on a floor plan into an IfcRoof of the chosen kind, pitch and thickness, linked to the contour: editing it, or its roof parameters, rebuilds the roof. The Slab button always draws slabs.
