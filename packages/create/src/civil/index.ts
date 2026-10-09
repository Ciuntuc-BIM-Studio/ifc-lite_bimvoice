/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Civil / road modelling: alignments, profiles, terrains, assemblies, corridors and LandXML. */

export {
  alignmentFromPolyline, alignmentProblem, buildAlignment, clothoidPoint, fitRadius, formatStation, sampleAlignment,
  type AlignmentPI, type AlignmentPoint, type HorizontalAlignment, type HorizontalAlignmentSpec, type AlignmentSegment, type AlignmentSegmentKind,
} from './alignment.js';
export { buildProfile, profileFromGround, profileProblem, type ProfilePVI, type VerticalProfile, type VerticalProfileSpec } from './profile.js';
export { Terrain, delaunay, parseSurveyPoints, tinFromMesh, type Tin } from './tin.js';
export {
  assemblyWidth, defaultAssembly, defaultDesign, pavementThickness, requiredSuperelevation, slopesAt, templateAt, templateSide,
  type AssemblyLane, type AssemblyLayer, type AssemblySpec, type SideSlopes, type SuperelevationDesign, type TemplatePoint,
} from './assembly.js';
export { buildCorridor, finishedGradeSurface, triangulatePolygon, type CorridorModel, type CorridorSolid, type CorridorSpec, type CorridorStation, type DaylightKind } from './corridor.js';
export { parseXml, readLandXml, writeLandXml, type LandXmlAlignmentIn, type LandXmlAlignmentOut, type LandXmlDocument, type LandXmlSurfaceOut, type XmlNode } from './landxml.js';
export {
  PRESET_IDS, PROFILE_LIBRARY_FORMAT, PROFILE_PRESETS, orient, presetParams, profileArea, profileBounds, profileFromPreset, profileIfcClass, readProfileLibrary,
  readStructureProfile, readStructureProfileList, regenerateProfile, signedArea, starterProfiles, structureProfileProblem, toCustomProfile, writeProfileLibrary,
  type P2, type PresetId, type PresetParam, type ProfileAnchor, type StructureKind, type StructureProfile,
} from './structure-profile.js';
export { triangulateWithHoles } from './triangulate.js';
export {
  componentFromProfile, componentSection, defaultDaylight, defaultSide, suppressesDaylight, sweepComponent,
  type ComponentAttach, type ComponentDaylight, type ComponentSide, type CorridorComponent, type StationFrame, type SweptComponent,
} from './components.js';
export { boundsOf, paper, translatePrims, type CivilDrawing, type DrawPen, type DrawPrim } from './drawing-prims.js';
export { DEFAULT_PROFILE_OPTIONS, profileDrawing, type ProfileDrawingLabels, type ProfileDrawingOptions } from './profile-drawing.js';
export { DEFAULT_SECTION_OPTIONS, oneSection, sampleStations, sectionsDrawing, type SectionDrawingLabels, type SectionDrawingOptions } from './section-drawing.js';
export { abutmentSections, abutmentSolids, defaultAbutment, extrudeOutline, type AbutmentSpec, type AbutmentType, type CorridorBridge, type ExtrudedSolid } from './bridge.js';
