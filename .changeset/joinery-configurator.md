---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Doors & windows configurator: the project keeps a catalogue of door and window types (saved in the project file, importable / exportable as JSON). The configurator edits size, frame and sash profiles, the panel grid (column widths and row heights in millimetres, merging cells) and each panel's operation from buttons drawn with its official symbol, boards, threshold, colours and Pset_WindowCommon / Pset_DoorCommon values, with live interior / exterior elevations, plan, section and an isometric view of the IFC body. The Door / Window tools place the current type (its IFC type written into the model the first time, the element typed and mapping its body); saving a type rewrites it in every model and refits the placed elements; a type can be applied to the selection. Flip hinge / Flip swing turn configured doors and windows in the model (mapped-item axes, so 3D, plans and exports agree), and plans draw them from their type instead of their cut.
