---
"@ifc-lite/viewer": minor
"@ifc-lite/create": minor
---

Parametric BIM objects on floor plan tabs, and mitred wall corners. The Design tab's BIM objects group (wall, slab, column, beam, curtain wall, door, window, opening, stair, railing, room, grid) runs the modeling commands on the floor plan in front, drawing on its storey — the same gestures, ghosts, snaps, joins and undo steps as the 3D view, with the command bar and typed fields over the plan. `computeWallJoin` gains `style: 'mitre'`: an L corner cut on its diagonal, stored on the `IfcRelConnectsPathElements` (`Description`) and kept when the walls move. The Joins group mitres, butts or swaps the corners of the selected walls, and sets the style new corners get. A model's bounds now grow with the geometry authored into it, so a model that started empty gets drawings and section planes.
