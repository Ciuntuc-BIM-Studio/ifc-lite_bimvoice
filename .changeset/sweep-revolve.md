---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Sweeps and revolves. `sweepFaces` carries a profile along a 3D path with mitred corners (closed paths wrap around) and `revolveFaces` turns a profile about an axis by any angle, both as closed shells for `addFacetedElementToStore`. In the viewer, the Design tab's Sweep (a closed profile along a drafted path) and Revolve (a closed profile about a drafted axis line) write IfcFacetedBrep elements of a typed class, linked to their profile: editing the profile, its path or axis, or the angle rebuilds them. A drafting view opened on an empty model no longer jumps to fit the first element drawn.
