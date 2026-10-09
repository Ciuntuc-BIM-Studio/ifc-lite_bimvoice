---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Bridges, part three:
- Intermediate piers (`PierSpec`, `defaultPier`, `distributePiers`). A pier is a wall, or a row of round or square columns under a cap. It reaches down to the terrain onto a continuous footing; in IFC4X3 its parts are IfcColumn PIERSTEM, IfcBeam PIERCAP and IfcFooting.
- Bearings (`BearingSpec`) on every abutment seat and pier top, as IfcBearing. Abutment seats drop by the bearings' height.
- Quarter cones of embankment at each abutment's sides. They are part of the fill surface and add to its volume.
- Cross-section cuts through abutments, piers and bearings, returned by `CorridorModel.componentsAt`.
- `CorridorModel.bridgeElevation` replaces the standalone `bridgeElevation` and now includes piers, bearings and cones.
- The deck reaches over the abutment seats to the back walls.
- The configurator gets a Piers and a Bearings section. The cross-section preview now cuts at the exact station instead of snapping to the nearest computed one.
