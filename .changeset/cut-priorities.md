---
"@ifc-lite/create": minor
"@ifc-lite/export": minor
"@ifc-lite/wasm": minor
"@ifc-lite/viewer": minor
---

Cut priorities between structural elements: where two overlap, the higher priority cuts the lower (footing › column › beam › member › slab › wall › plate by default, overridable per element in the Model inspector). The cut is an IfcRelInterferesElements with ImpliedOrder TRUE — the related element subtracted from the relating one, as the schema defines it — which the geometry pre-pass now applies like an opening, so both elements keep their own parametric bodies. Every modelling commit re-cuts the structural elements it built or changed in the same undo step, deleting an element drops its cuts, "Cut priorities" on the Design tab applies them to the selection or the whole model, and re-meshing an element brings the elements that cut it or that it cuts.
