---
"@ifc-lite/create": minor
"@ifc-lite/viewer": minor
---

Joinery types: a door or window type as one spec (overall size, frame and its position across the wall, a grid of columns and rows split by mullions and transoms, per panel its operation — fixed, side-hung, tilt-and-turn, bottom / top hung, pivot, sliding, door leaves swinging, double-acting, sliding, folding), written as an IfcWindowType / IfcDoorType with its PartitioningType or OperationType, lining and panel property sets, Pset_WindowCommon / Pset_DoorCommon and a representation map (frame, sashes, glass, leaves, handles, boards) that occurrences share through IfcMappedItem; hosted doors and windows can map it. Its drawings come from the spec, not the mesh: plan (sliced at the cut height, door leaves open with their swing), elevation (DIN / SR opening marks meeting at the hinges, dashed seen from the other side, optional hinges and handles) and section. Plan views draw configured doors and windows from their type, oriented by the element's real placement.
