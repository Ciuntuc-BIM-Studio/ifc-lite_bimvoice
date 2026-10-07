---
"@ifc-lite/viewer": minor
"@ifc-lite/create": minor
---

New Project (File tab, Project Navigator): start a fresh IFC model configured up front — project name, description, author and organization; the IfcSite's name, address and geographic reference (latitude / longitude / elevation); the IfcBuilding's name and long name; the levels (generated from a count and floor height, or edited row by row); length unit and schema. `IfcCreator` now takes `Site` and `Building` parameters (names, descriptions, long names and the site's RefLatitude / RefLongitude / RefElevation) instead of fixed "Site" / "Building" entities.
