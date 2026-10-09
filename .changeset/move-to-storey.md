---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Move elements to another storey and edit an element's full placement:
- `moveElementsToStoreyInStore` moves elements (and the parts they aggregate) out of their storey's IfcRelContainedInSpatialStructure into the target storey's. Placements that hung from the old storey's placement now hang from the new one's. Elements are kept relative to the storey (they move with the level) or kept in place in space.
- `setElementPlacementInStore` and `readElementPlacement` write and read an element's offsets and its rotations about X, Y and Z in its parent's frame. Changes go to a fresh point, fresh directions and a fresh IfcAxis2Placement3D, and parts placed beside the element follow rigidly.
- `placement-3d` adds full 3D frame helpers.
- Viewer: Design › Move to storey, and a Placement card in the properties panel (storey picker, X/Y/Z, rotations X/Y/Z).
- Roof systems and corridors now regenerate on their effective storey.
