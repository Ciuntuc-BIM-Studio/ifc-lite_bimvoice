// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! WASM API: meshNativeSolids — Lapin native elements meshed straight from
//! their parameters (N2, `ifc_lite_geometry::native_solid`), no STEP text.
//! The buffer format is documented there. Positions are in the caller's
//! frame (the native storey frame, Z up, metres).

use ifc_lite_geometry::native_solid::{mesh_native_solids, slice_native_layers, NativeLayers};
use ifc_lite_geometry::TessellationQuality;
use wasm_bindgen::prelude::*;

/// Mesh every solid of `data`. Returns an array with, per solid, either
/// `{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }`
/// or `{ error: string }`; throws only when the buffer itself is malformed.
#[wasm_bindgen(js_name = meshNativeSolids)]
pub fn mesh_native_solids_js(data: &[f64]) -> Result<js_sys::Array, JsValue> {
    let meshes = mesh_native_solids(data, TessellationQuality::Medium).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let out = js_sys::Array::new_with_length(meshes.len() as u32);
    for (i, mesh) in meshes.iter().enumerate() {
        let entry = js_sys::Object::new();
        match mesh {
            Ok(mesh) => {
                crate::api::set_js_prop(&entry, "positions", &js_sys::Float32Array::from(&mesh.positions[..]));
                crate::api::set_js_prop(&entry, "normals", &js_sys::Float32Array::from(&mesh.normals[..]));
                crate::api::set_js_prop(&entry, "indices", &js_sys::Uint32Array::from(&mesh.indices[..]));
            }
            Err(error) => {
                crate::api::set_js_prop(&entry, "error", &JsValue::from_str(&error.to_string()));
            }
        }
        out.set(i as u32, entry.into());
    }
    Ok(out)
}

/// Read element `i`'s layers from the `layers` buffer at `at`:
/// `n axis(1..3) sense offset frame[16] (materialId thickness)*n`, or just `0`.
fn read_layers(buf: &[f64], at: &mut usize) -> Result<Option<NativeLayers>, JsValue> {
    let mut next = || -> Result<f64, JsValue> {
        let v = *buf.get(*at).ok_or_else(|| JsValue::from_str("meshNativeElements: layers buffer ends early"))?;
        *at += 1;
        Ok(v)
    };
    let n = next()? as usize;
    if n == 0 {
        return Ok(None);
    }
    let axis = match next()? as u32 { 1 => [1., 0., 0.], 2 => [0., 1., 0.], _ => [0., 0., 1.] };
    let (sense, offset) = (next()?, next()?);
    let mut m = [0.0; 16];
    for v in &mut m {
        *v = next()?;
    }
    let mut layers = Vec::with_capacity(n);
    for _ in 0..n {
        layers.push((next()? as u32, next()?));
    }
    Ok(Some(NativeLayers { layers, axis, sense, offset, frame: ifc_lite_geometry::Matrix4::from_column_slice(&m) }))
}

/// `mesh` (world, metres, before the RTC shift) told its element frame: the
/// placement as `local_to_world` (row-major) and its bounds in that frame.
fn place_in_frame(mesh: &mut ifc_lite_geometry::Mesh, m: &ifc_lite_geometry::Matrix4<f64>) {
    let mut row_major = [0.0; 16];
    for r in 0..4 {
        for c in 0..4 {
            row_major[r * 4 + c] = m[(r, c)];
        }
    }
    mesh.local_to_world = Some(row_major);
    let Some(inverse) = m.try_inverse() else { return };
    let (mut min, mut max) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for p in mesh.positions.chunks_exact(3) {
        let q = inverse.transform_point(&ifc_lite_geometry::Point3::new(p[0] as f64, p[1] as f64, p[2] as f64));
        for (k, v) in [q.x, q.y, q.z].into_iter().enumerate() {
            min[k] = min[k].min(v);
            max[k] = max[k].max(v);
        }
    }
    if min[0].is_finite() {
        mesh.local_bounds = Some([min[0] as f32, min[1] as f32, min[2] as f32, max[0] as f32, max[1] as f32, max[2] as f32]);
    }
}

/// Native elements as the remesh path's `MeshCollection` (N3): solid `i` is
/// element `express_ids[i]` of class `ifc_types[i]`, coloured `colors[4i..]`,
/// drawn from the representation item `item_ids[i]` (0: none), which its mesh
/// names as `geometryItemId` as the IFC path's does, and placed by the element
/// frame `frames[16i..]` (column-major, metres, NaN first: none), which its
/// mesh carries as `localToWorld` / `localBounds` as the IFC path's do (what
/// a typed door's plan symbol is drawn in).
/// The solids' placements already take them into the model's IFC frame in
/// metres. An element with material layers (`layers`, see `read_layers`) is
/// sliced into one mesh per visual layer with the IFC path's slicer, each
/// tagged with its `IfcMaterial` id and coloured from `material_colors`
/// (RGBA per `material_ids` entry; the element's colour when absent). Then the
/// load's RTC offset is subtracted (as `processGeometryBatch` does) and Z-up
/// becomes Y-up through `MeshDataJs::new`, so the result goes through
/// `convertMeshCollectionToBatch` like any re-meshed batch. Throws when a
/// solid cannot be built: the caller re-meshes those elements the IFC way.
#[wasm_bindgen(js_name = meshNativeElements)]
#[allow(clippy::too_many_arguments)]
pub fn mesh_native_elements_js(
    data: &[f64],
    express_ids: &[u32],
    ifc_types: Vec<String>,
    colors: &[f32],
    item_ids: &[u32],
    frames: &[f64],
    layers: &[f64],
    material_ids: &[u32],
    material_colors: &[f32],
    rtc_x: f64,
    rtc_y: f64,
    rtc_z: f64,
    needs_shift: bool,
) -> Result<crate::zero_copy::MeshCollection, JsValue> {
    let meshes = mesh_native_solids(data, TessellationQuality::Medium).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if meshes.len() != express_ids.len() || ifc_types.len() != meshes.len() || colors.len() != meshes.len() * 4
        || item_ids.len() != meshes.len() || frames.len() != meshes.len() * 16 || material_colors.len() != material_ids.len() * 4 {
        return Err(JsValue::from_str("meshNativeElements: ids, types and colours must match the solids"));
    }
    let material_color = |id: u32| material_ids.iter().position(|&m| m == id)
        .map(|k| [material_colors[k * 4], material_colors[k * 4 + 1], material_colors[k * 4 + 2], material_colors[k * 4 + 3]]);
    let mut collection = crate::zero_copy::MeshCollection::with_capacity(meshes.len());
    if needs_shift {
        collection.set_rtc_offset(rtc_x, rtc_y, rtc_z);
    }
    let mut at = 0;
    for (i, mesh) in meshes.into_iter().enumerate() {
        let mesh = mesh.map_err(|e| JsValue::from_str(&format!("meshNativeElements: element #{}: {e}", express_ids[i])))?;
        let color = [colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]];
        let parts: Vec<(Option<u32>, ifc_lite_geometry::Mesh)> = match read_layers(layers, &mut at)? {
            Some(stack) => match slice_native_layers(&mesh, &stack) {
                Some(sliced) => sliced.into_iter().map(|(m, part)| (Some(m), part)).collect(),
                None => vec![(None, mesh)],
            },
            None => vec![(None, mesh)],
        };
        let frame = frames[i * 16].is_finite().then(|| ifc_lite_geometry::Matrix4::from_column_slice(&frames[i * 16..i * 16 + 16]));
        for (material, mut part) in parts {
            if let Some(m) = &frame {
                place_in_frame(&mut part, m);
            }
            if needs_shift {
                for p in part.positions.chunks_exact_mut(3) {
                    p[0] = (p[0] as f64 - rtc_x) as f32;
                    p[1] = (p[1] as f64 - rtc_y) as f32;
                    p[2] = (p[2] as f64 - rtc_z) as f32;
                }
            }
            part.rtc_applied = true;
            let tint = material.and_then(material_color).unwrap_or(color);
            let mut js = crate::zero_copy::MeshDataJs::new(express_ids[i], ifc_types[i].clone(), part, tint);
            // A layer slice names its material, a whole body its item: never both.
            if material.is_some() {
                js.set_source_ids(None, material);
            } else if item_ids[i] != 0 {
                js.set_source_ids(Some(item_ids[i]), None);
            }
            collection.add(js);
        }
    }
    Ok(collection)
}
