---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

A robust Delete. Delete and Backspace now delete the selected elements from the model (they used to only hide them, in 3D, while plans and sections still drew them); Space still hides. Delete — the key, the context menu (the whole selection when the clicked element is in it) and the geometry card — removes the elements with what depends on them (`deletionClosure`: a wall with its openings and the doors and windows in them, a door or window with its opening so the wall closes, an assembly with its parts; levels and buildings are refused), takes their meshes out of every view, prunes the geometry only they used, redoes cuts, unlinks drafted contours, and is one undo step. On a drawing tab, Ctrl+Z / Ctrl+Shift+Z (and the toolbar buttons) undo and redo whichever came last, a drafting or a model step. Redoing a delete no longer fills the hidden set with geometry records.
