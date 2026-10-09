---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Model groups, Revit / Blender style: `createGroupInStore`, `addToGroupInStore`, `removeFromGroupInStore`, `ungroupInStore`, `renameGroupInStore`, `modelGroups`, `groupOfElement` write and read plain IfcGroup objects (ObjectType 'Model group') with IfcRelAssignsToGroup; an element belongs to one model group at a time. In the viewer, Design › Groups: Group, Ungroup, Edit group and Select groups; a click on any member selects the whole group; Edit group turns the rest of the model X-ray and unselectable, takes in what is built meanwhile, and offers Add / Remove / Finish; the Model inspector shows the element's group. The Design and Infrastructure tools now switch Edit mode on by themselves (with a note) instead of refusing.
