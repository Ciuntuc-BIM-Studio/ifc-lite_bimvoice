---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Corridor components: library structure profiles swept along a corridor over a station range (left, right or centre; at the road edge or the axis; with an offset), optionally replacing the earthwork slopes on their side or both, and — for a preset wall — with a height that follows the ground. Each becomes its own triangulated element with the profile's IFC class (IfcWall RETAININGWALL, IfcKerb, IfcRailing GUARDRAIL, IfcSlab, proxies…, with IFC4 fall-backs), kept across regenerations by its Tag. New `triangulateWithHoles` for the swept caps. The corridor configurator gets a Components section and draws them in its cross-section preview.
