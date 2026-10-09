---
"@ifc-lite/viewer": minor
---

Projects save and open as one package (`.bvproj`, a ZIP): a manifest with every part's SHA-256, the project document split into parts (views, sheets, drafts per view, standards, catalogues — fields it does not know stay in the document part), the native models as complete IFC with all their edits (an unedited model from its source bytes), linked models as references. File › Open project / Save project / Save project as… (Ctrl+S, Ctrl+Shift+S; written in place where the browser allows, else downloaded) and Link model: a linked model is read-only — the mutation policy and every modelling commit refuse it — and after an open the linked models are listed to locate. While a project has unsaved changes a recovery copy is kept in IndexedDB and offered back at startup. A damaged, foreign or newer package is refused with a reason; the old `.ifclite-project.json` export stays.
