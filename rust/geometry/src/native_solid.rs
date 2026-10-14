// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Meshing Lapin native elements straight from their parameters (N2,
//! docs/format-lapin-nativ.md): no STEP text is written or parsed. An element
//! arrives as one or more extruded solids — a profile (a polygon with holes,
//! or a parametric IFC section built by the same [`ProfileProcessor`] the IFC
//! path uses, so the two agree), a placement, a depth — and the solids to cut
//! from it (openings). Element parameters (a wall's outline after its end
//! cuts, where an opening sits) are resolved by the caller; this module only
//! extrudes and subtracts.
//!
//! Wire format (one `f64` buffer, so the WASM boundary is a single copy):
//!
//! ```text
//! buffer := count solid*
//! solid  := profile placement[16] depth cutCount cut*
//! cut    := profile placement[16] depth            (cuts carry no cuts)
//! profile:= 0 outerCount (x y)* holeCount (n (x y)*)*   polygon
//!         | code dimCount dim*                         section (codes below)
//!         | 100 faceCount (loopCount (n (x y z)*)*)*  faces (outer loop, then holes)
//! ```
//! A `faces` solid is a closed polyhedron (a faceted element: a rafter with
//! cut ends, a sloped roof, the prism a roof trim removes from a wall),
//! triangulated face by face as the IFC path triangulates an IfcFacetedBrep;
//! its points are in the profile frame and its depth is ignored.
//! `placement` is a column-major 4x4 matrix taking the profile frame (profile
//! in XY, extruded along +Z) to the element frame. A section dimension that
//! is NaN is absent (an optional fillet).

use crate::error::{Error, Result};
use crate::extrusion::extrude_profile;
use crate::kernel::mesh_bridge::{subtract, subtract_many, BatchSubtract};
use crate::mesh::Mesh;
use crate::rect_fast::{subtract_rect_openings, RectFastStats};
use crate::profile::Profile2D;
use crate::profiles::ProfileProcessor;
use crate::processors::FacetedBrepProcessor;
use crate::csg::calculate_normals;
use crate::tessellation::TessellationQuality;
use ifc_lite_core::{AttributeValue, DecodedEntity, EntityDecoder, IfcSchema, IfcType};
use nalgebra::{Matrix4, Point2, Point3, Vector3};

/// A profile: a plan polygon, or a parametric IFC section.
#[derive(Debug, Clone)]
pub enum NativeProfile {
    Polygon(Profile2D),
    /// The IFC class and its dimension attributes in schema order (after
    /// ProfileType, ProfileName and Position); `None` for an absent optional.
    Section { ifc_type: IfcType, dims: Vec<Option<f64>> },
    /// Planar faces, each an outer loop and its holes.
    Faces(Vec<(Vec<Point3<f64>>, Vec<Vec<Point3<f64>>>)>),
}

/// The wire code of a `faces` profile.
const FACES: usize = 100;

#[derive(Debug, Clone)]
pub struct NativeSolid {
    pub profile: NativeProfile,
    pub placement: Matrix4<f64>,
    pub depth: f64,
    /// Subtracted from this solid's mesh.
    pub cuts: Vec<NativeSolid>,
}

/// Section codes of the wire format, in `ProfileSection` order.
const SECTION_TYPES: [IfcType; 9] = [
    IfcType::IfcRectangleProfileDef,
    IfcType::IfcIShapeProfileDef,
    IfcType::IfcLShapeProfileDef,
    IfcType::IfcTShapeProfileDef,
    IfcType::IfcUShapeProfileDef,
    IfcType::IfcCShapeProfileDef,
    IfcType::IfcCircleProfileDef,
    IfcType::IfcRectangleHollowProfileDef,
    IfcType::IfcCircleHollowProfileDef,
];

struct Reader<'a> {
    data: &'a [f64],
    at: usize,
}

impl Reader<'_> {
    fn next(&mut self) -> Result<f64> {
        let v = *self
            .data
            .get(self.at)
            .ok_or_else(|| Error::geometry("native solids: buffer ends early"))?;
        self.at += 1;
        Ok(v)
    }
    fn count(&mut self, limit: usize) -> Result<usize> {
        let v = self.next()?;
        if !(v >= 0.0 && v.fract() == 0.0 && (v as usize) <= limit) {
            return Err(Error::geometry(format!("native solids: bad count {v}")));
        }
        Ok(v as usize)
    }
    fn finite(&mut self) -> Result<f64> {
        let v = self.next()?;
        if !v.is_finite() {
            return Err(Error::geometry("native solids: non-finite value"));
        }
        Ok(v)
    }
    fn ring(&mut self) -> Result<Vec<Point2<f64>>> {
        let n = self.count(self.data.len() / 2)?;
        (0..n).map(|_| Ok(Point2::new(self.finite()?, self.finite()?))).collect()
    }
    fn points(&mut self) -> Result<Vec<Point3<f64>>> {
        let n = self.count(self.data.len() / 3)?;
        (0..n).map(|_| Ok(Point3::new(self.finite()?, self.finite()?, self.finite()?))).collect()
    }
    fn profile(&mut self) -> Result<NativeProfile> {
        let code = self.count(FACES)?;
        if code == FACES {
            let faces = (0..self.count(self.data.len())?)
                .map(|_| {
                    let loops = self.count(self.data.len())?;
                    if loops == 0 {
                        return Err(Error::geometry("native solids: a face without a loop"));
                    }
                    let outer = self.points()?;
                    let holes = (1..loops).map(|_| self.points()).collect::<Result<Vec<_>>>()?;
                    Ok((outer, holes))
                })
                .collect::<Result<Vec<_>>>()?;
            return Ok(NativeProfile::Faces(faces));
        }
        if code > SECTION_TYPES.len() {
            return Err(Error::geometry(format!("native solids: unknown profile code {code}")));
        }
        if code == 0 {
            let mut profile = Profile2D::new(self.ring()?);
            let holes = self.count(self.data.len())?;
            for _ in 0..holes {
                profile.add_hole(self.ring()?);
            }
            return Ok(NativeProfile::Polygon(profile));
        }
        let n = self.count(16)?;
        let dims = (0..n)
            .map(|_| self.next().map(|v| v.is_finite().then_some(v)))
            .collect::<Result<_>>()?;
        Ok(NativeProfile::Section { ifc_type: SECTION_TYPES[code - 1].clone(), dims })
    }
    fn solid(&mut self, with_cuts: bool) -> Result<NativeSolid> {
        let profile = self.profile()?;
        let mut m = [0.0; 16];
        for v in &mut m {
            *v = self.finite()?;
        }
        let depth = self.finite()?;
        let mut cuts = Vec::new();
        if with_cuts {
            let n = self.count(self.data.len())?;
            for _ in 0..n {
                cuts.push(self.solid(false)?);
            }
        }
        Ok(NativeSolid { profile, placement: Matrix4::from_column_slice(&m), depth, cuts })
    }
}

/// Decode a wire-format buffer into solids.
pub fn decode_native_solids(data: &[f64]) -> Result<Vec<NativeSolid>> {
    let mut reader = Reader { data, at: 0 };
    let count = reader.count(data.len())?;
    let solids = (0..count).map(|_| reader.solid(true)).collect::<Result<Vec<_>>>()?;
    if reader.at != data.len() {
        return Err(Error::geometry("native solids: trailing data"));
    }
    Ok(solids)
}

fn profile_2d(profile: &NativeProfile, quality: TessellationQuality) -> Result<Profile2D> {
    match profile {
        NativeProfile::Polygon(p) => Ok(p.clone()),
        NativeProfile::Faces(_) => Err(Error::geometry("native solids: faces have no profile")),
        NativeProfile::Section { ifc_type, dims } => {
            // The same parametric builder the IFC path runs, on a synthetic
            // entity: ProfileType AREA, no name, no position (centred).
            let mut attributes = vec![AttributeValue::Enum("AREA".into()), AttributeValue::Null, AttributeValue::Null];
            attributes.extend(dims.iter().map(|d| d.map_or(AttributeValue::Null, AttributeValue::Float)));
            let entity = DecodedEntity::new(0, ifc_type.clone(), attributes);
            let empty = "";
            let mut decoder = EntityDecoder::new(&empty);
            ProfileProcessor::new(IfcSchema::new()).process(&entity, &mut decoder, quality)
        }
    }
}

fn extrude(solid: &NativeSolid, quality: TessellationQuality) -> Result<Mesh> {
    if let NativeProfile::Faces(faces) = &solid.profile {
        let mut mesh = FacetedBrepProcessor::mesh_faces(faces);
        if mesh.indices.is_empty() {
            return Err(Error::geometry("native solid faces make no triangles"));
        }
        for p in mesh.positions.chunks_exact_mut(3) {
            let q = solid.placement.transform_point(&Point3::new(p[0] as f64, p[1] as f64, p[2] as f64));
            p.copy_from_slice(&[q.x as f32, q.y as f32, q.z as f32]);
        }
        calculate_normals(&mut mesh);
        return Ok(mesh);
    }
    if !(solid.depth > 0.0) {
        return Err(Error::InvalidExtrusion("native solid depth must be positive".into()));
    }
    extrude_profile(&profile_2d(&solid.profile, quality)?, solid.depth, Some(solid.placement))
}

/// A cut's box in its host's own frame, when it is one: a rectangle profile
/// placed without turning relative to the host (what wall openings are).
fn local_box(cut: &NativeSolid, host_inverse: &Matrix4<f64>) -> Option<([f64; 3], [f64; 3])> {
    let NativeProfile::Polygon(profile) = &cut.profile else { return None };
    if profile.outer.len() != 4 || !profile.holes.is_empty() {
        return None;
    }
    let local = host_inverse * cut.placement;
    for r in 0..3 {
        for c in 0..3 {
            if (local[(r, c)] - if r == c { 1.0 } else { 0.0 }).abs() > 1e-9 {
                return None;
            }
        }
    }
    let (xs, ys): (Vec<f64>, Vec<f64>) = profile.outer.iter().map(|p| (p.x, p.y)).unzip();
    let (x0, x1) = (xs.iter().cloned().fold(f64::INFINITY, f64::min), xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
    let (y0, y1) = (ys.iter().cloned().fold(f64::INFINITY, f64::min), ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
    // Every corner on the box: an axis-aligned rectangle, not a rotated quad.
    if !profile.outer.iter().all(|p| (p.x == x0 || p.x == x1) && (p.y == y0 || p.y == y1)) {
        return None;
    }
    let t = [local[(0, 3)], local[(1, 3)], local[(2, 3)]];
    Some(([t[0] + x0, t[1] + y0, t[2]], [t[0] + x1, t[1] + y1, t[2] + cut.depth]))
}

/// `mesh` taken by the rigid placement `m` (normals turned by its rotation).
fn transformed(mut mesh: Mesh, m: &Matrix4<f64>) -> Mesh {
    let rotation = m.fixed_view::<3, 3>(0, 0).into_owned();
    for p in mesh.positions.chunks_exact_mut(3) {
        let q = m.transform_point(&Point3::new(p[0] as f64, p[1] as f64, p[2] as f64));
        p.copy_from_slice(&[q.x as f32, q.y as f32, q.z as f32]);
    }
    for n in mesh.normals.chunks_exact_mut(3) {
        let v = rotation * Vector3::new(n[0] as f64, n[1] as f64, n[2] as f64);
        n.copy_from_slice(&[v.x as f32, v.y as f32, v.z as f32]);
    }
    mesh
}

/// One solid's mesh, its cuts subtracted. Box cuts through a box host (a wall
/// and its openings) take the analytic cellular cut in the host's own frame
/// (`rect_fast`, what the IFC path does for them); anything else the exact
/// kernel, in one batch when the cuts allow it.
pub fn mesh_native_solid(solid: &NativeSolid, quality: TessellationQuality) -> Result<Mesh> {
    if solid.cuts.is_empty() {
        return extrude(solid, quality);
    }
    if let Some(inverse) = solid.placement.try_inverse() {
        if let Some(boxes) = solid.cuts.iter().map(|c| local_box(c, &inverse)).collect::<Option<Vec<_>>>() {
            let local = NativeSolid { placement: Matrix4::identity(), cuts: Vec::new(), ..solid.clone() };
            let host = extrude(&local, quality)?;
            if let Some(cut) = subtract_rect_openings(&host, &boxes, &mut RectFastStats::default()) {
                return Ok(transformed(cut, &solid.placement));
            }
        }
    }
    let host = extrude(solid, quality)?;
    let cutters = solid.cuts.iter().map(|c| extrude(c, quality)).collect::<Result<Vec<_>>>()?;
    let refs: Vec<&Mesh> = cutters.iter().collect();
    Ok(match subtract_many(&host, &refs) {
        BatchSubtract::Cut(mesh) => mesh,
        BatchSubtract::Unchanged => host,
        BatchSubtract::Nonconforming => cutters.iter().fold(host, |acc, c| subtract(&acc, c)),
    })
}

/// A native element's material layers, as an `IfcMaterialLayerSetUsage` describes them.
#[derive(Debug, Clone)]
pub struct NativeLayers {
    /// `(IfcMaterial id, thickness in metres)`, in stack order.
    pub layers: Vec<(u32, f64)>,
    /// The axis the layers stack along, in the element's frame (AXIS1/2/3 as a unit vector).
    pub axis: [f64; 3],
    /// `+1` for POSITIVE, `-1` for NEGATIVE.
    pub sense: f64,
    /// OffsetFromReferenceLine, metres.
    pub offset: f64,
    /// The element's placement in the frame the mesh is in.
    pub frame: Matrix4<f64>,
}

/// Slice `mesh` into one mesh per visual layer, with the IFC path's own
/// slicer (thin layers merged, uncapped interface cuts), each with its
/// `IfcMaterial` id. `None` when there is nothing to slice.
pub fn slice_native_layers(mesh: &Mesh, layers: &NativeLayers) -> Option<Vec<(u32, Mesh)>> {
    use crate::material_layer_index::LayerInfo;
    let infos: Vec<LayerInfo> = layers.layers.iter().map(|&(material_id, thickness)| LayerInfo { material_id, thickness }).collect();
    let visual = crate::router::merge_thin_layers(&infos, 1.0);
    if visual.len() < 2 {
        return None;
    }
    let axis = Vector3::new(layers.axis[0], layers.axis[1], layers.axis[2]);
    let rotation = layers.frame.fixed_view::<3, 3>(0, 0);
    let normal = (rotation * axis).try_normalize(1e-12)? * layers.sense;
    let mut planes = Vec::with_capacity(visual.len() - 1);
    let mut cumulative = 0.0;
    for layer in &visual[..visual.len() - 1] {
        cumulative += layer.thickness_m;
        let d = layers.offset + layers.sense * cumulative;
        let origin = layers.frame.transform_point(&Point3::new(axis.x * d, axis.y * d, axis.z * d));
        planes.push(crate::csg::Plane::new(origin, normal));
    }
    let sliced = crate::router::slice_mesh_into_layers(mesh, &visual, &planes);
    let out: Vec<(u32, Mesh)> = sliced.sub_meshes.into_iter().map(|s| (s.geometry_id, s.mesh)).collect();
    (out.len() >= 2).then_some(out)
}

/// Every solid of a buffer, meshed; a solid that cannot be built is `Err` in its slot.
pub fn mesh_native_solids(data: &[f64], quality: TessellationQuality) -> Result<Vec<Result<Mesh>>> {
    Ok(decode_native_solids(data)?.iter().map(|s| mesh_native_solid(s, quality)).collect())
}

#[cfg(test)]
#[path = "native_solid_tests.rs"]
mod tests;
