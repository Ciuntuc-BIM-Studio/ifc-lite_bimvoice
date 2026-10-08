---
"@ifc-lite/viewer": minor
---

DXF exports (views and sheets) are now DXF R2000 and carry their layers: drafted lines and annotations land on their drafting layer with its colour (ACI and true colour), line type (DASHED, DOT, DASHDOT, scaled to the view) and line weight; the generated drawing goes on CUT / SEEN / HIDDEN / HATCH / SYMBOLS with its pens; closed outlines stay closed polylines. Entities are BYLAYER unless they differ from their layer.
