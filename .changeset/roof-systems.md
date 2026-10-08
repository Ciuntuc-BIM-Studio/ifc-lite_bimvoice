---
"@ifc-lite/create": minor
---

Roof systems: a roof from an outline and a rule per edge — eave (pitch, overhang) or gable (rake) — solved as a weighted straight skeleton (`weightedSkeletonFaces`: each edge moves in at its own speed, a gable stays put), so planes of different pitches and overhangs meet on their true hips, valleys and ridges (`roofGeometry`, with the ridge / hip / valley / eave / verge lines). `roofStructure` lays rafters at a spacing, hip and valley rafters, ridge beams, purlins and wall plates under the covering. `addRoofSystemToStore` writes it as an IfcRoof aggregating one IfcSlab ROOF per plane and IfcMember RAFTER / PURLIN / PLATE parts, its spec in Pset_IfcLiteRoofSystem; `regenerateRoofSystemInStore` rebuilds it in place, parts that are still generated keeping their entity and GlobalId.
