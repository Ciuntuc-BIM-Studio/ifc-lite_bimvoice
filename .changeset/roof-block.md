---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Roof systems as one parametric block. ROOF draws the roof's own outline on the plan by default (click the corners, C / Enter / the first corner closes; PICK keeps turning an existing contour into a linked roof). A click on any plane or member — in 3D or inside the outline on the plan — selects the whole roof, the roof inspected with its card (Edit roof, Configure…). Selected on the plan, a roof that owns its outline shows grips: drag a corner, drag an edge's middle to add a corner, double-click a corner to remove it. A double click (or Edit roof) enters the block: its parts are picked one by one and edited as overrides kept by part key across regenerations — delete / restore, section, extend or shorten either end, square / plumb / level end cuts (members become solids of their own), colour; the structure sets rafters' default eave and ridge cuts. Fixes: 3D shows the storeys above the working storey by default (a roof drawn on Level 1 was hidden while the session stood on the ground floor), and elements authored in the session re-mesh in their own colours (the overlay's styled items join the model's style wire).
