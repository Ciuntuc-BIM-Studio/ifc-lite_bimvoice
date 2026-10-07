---
"@ifc-lite/viewer": minor
"@ifc-lite/renderer": minor
---

Work planes: every view is a work plane, also without any geometry (an empty new project's floor plan is the level's horizontal plane), and lines drafted on a view show in 3D on that plane through a new `drafting` line-overlay channel. The Design tab gains a Section line tool (two points and a side on a floor plan make a vertical section through the line, a new view and work plane) and Work plane from face (pick any face in 3D; its plane becomes a view to draft on).
