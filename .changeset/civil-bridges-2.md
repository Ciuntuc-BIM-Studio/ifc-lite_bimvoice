---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Bridges, part two:
- Abutments are structure profiles: there are wall and gravity abutment presets, and any profile can be edited point by point. Each abutment has its own footing. A preset's height follows the terrain, and a drawn profile stretches below the bearing seat.
- `bridgeElevation` unrolls a bridge along its alignment for the configurator's new elevation preview.
- The new Infrastructure › Bridge command (BRIDGE) builds a bridge along a selected axis and opens the configurator in bridge mode.
- The PVI table takes a grade in % per tangent (`segmentGrades`, `withSegmentGrade`).
- Decks and components take a cross-fall (`tilt`) that turns their profile in its own plane.
