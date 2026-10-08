---
"@ifc-lite/viewer": minor
---

Closed contours from any linework: clicking inside an area for EXTRUDE, ROOF, SWEEP, REVOLVE or HATCH now finds whatever drafted lines, arcs and polylines enclose there — end to end or crossing, ends welded within 1 mm (an arrangement, as AutoCAD's BOUNDARY) — not only single closed polylines. A picked region's holes become editable contours too, and a contour that crosses itself, or a hole that runs outside it, is refused with a clear message instead of building a broken solid.
