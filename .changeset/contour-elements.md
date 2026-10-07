---
"@ifc-lite/viewer": minor
"@ifc-lite/create": minor
---

Closed contours become IFC elements. `addExtrusionToStore` writes any IfcElement class in a loaded model as an IfcExtrudedAreaSolid with an arbitrary profile (voids via IfcArbitraryProfileDefWithVoids), an oriented placement and storey containment, laid out per schema; `replaceExtrusionGeometryInStore` rebuilds its geometry keeping the element and GlobalId. In the viewer, the Design tab's Extrude turns a closed drafted contour — or any closed region, cut outlines included — into an element of a typed class and depth on the view's work plane (a floor plan's level, a section's plane), one undo step. The contour keeps the element's GlobalId: editing the contour, its depth or class updates the element in place, and its other parameters become the element's `IfcLite_Parameters` properties. Views also open on empty models, as bare work planes.
