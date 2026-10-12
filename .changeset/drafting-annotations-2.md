---
"@ifc-lite/viewer": minor
---

2D drafting:
- Linear and aligned dimensions continue by default along the first one's dimension line and direction; S at the start makes a single dimension.
- Holding Ctrl while drawing constrains to orthogonal directions. A snapped point stays where it snapped even with ortho on. Snap and Ortho buttons are also on the Annotations tab.
- Dimension lines and grid axes are snap targets, so new dimensions align to existing ones.
- Leaders default to two segments: a free arrow segment, then a horizontal or vertical landing with guides. F frees the landing.
- Fix: a section line drawn on a plan stays as a section mark on every plan (screen, sheets, DXF), stored on the section view.
- Level marks are parametric: the measured reference point is kept apart from the symbol, and the value follows the reference, the storey or the section plane.
- Dimension text positions are now read back from project files.
