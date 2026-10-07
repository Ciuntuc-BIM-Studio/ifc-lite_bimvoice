---
"@ifc-lite/drawing-2d": patch
---

Elevations and other views whose plane cuts little or nothing no longer draw as scattered fragments. The artifact-line filter now measures projected lines against the cut area together with the meshes' own footprint on the drawing plane, instead of the cut area alone, so real facade edges are kept while lines longer than the whole model are still dropped.
