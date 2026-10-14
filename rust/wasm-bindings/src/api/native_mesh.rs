// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! WASM API: meshNativeSolids — Lapin native elements meshed straight from
//! their parameters (N2, `ifc_lite_geometry::native_solid`), no STEP text.
//! The buffer format is documented there. Positions are in the caller's
//! frame (the native storey frame, Z up, metres).

use ifc_lite_geometry::native_solid::mesh_native_solids;
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

/// Native elements as the remesh path's `MeshCollection` (N3): solid `i` is
/// element `express_ids[i]` of class `ifc_types[i]`, coloured `colors[4i..]`.
/// The solids' placements already take them into the model's IFC frame in
/// metres; this subtracts the load's RTC offset (as `processGeometryBatch`
/// does) and converts Z-up to Y-up through `MeshDataJs::new`, so the result
/// goes through `convertMeshCollectionToBatch` like any re-meshed batch.
/// Throws when a solid cannot be built: the caller re-meshes those elements
/// the IFC way.
#[wasm_bindgen(js_name = meshNativeElements)]
#[allow(clippy::too_many_arguments)]
pub fn mesh_native_elements_js(
    data: &[f64],
    express_ids: &[u32],
    ifc_types: Vec<String>,
    colors: &[f32],
    rtc_x: f64,
    rtc_y: f64,
    rtc_z: f64,
    needs_shift: bool,
) -> Result<crate::zero_copy::MeshCollection, JsValue> {
    let meshes = mesh_native_solids(data, TessellationQuality::Medium).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if meshes.len() != express_ids.len() || ifc_types.len() != meshes.len() || colors.len() != meshes.len() * 4 {
        return Err(JsValue::from_str("meshNativeElements: ids, types and colours must match the solids"));
    }
    let mut collection = crate::zero_copy::MeshCollection::with_capacity(meshes.len());
    if needs_shift {
        collection.set_rtc_offset(rtc_x, rtc_y, rtc_z);
    }
    for (i, mesh) in meshes.into_iter().enumerate() {
        let mut mesh = mesh.map_err(|e| JsValue::from_str(&format!("meshNativeElements: element #{}: {e}", express_ids[i])))?;
        if needs_shift {
            for p in mesh.positions.chunks_exact_mut(3) {
                p[0] = (p[0] as f64 - rtc_x) as f32;
                p[1] = (p[1] as f64 - rtc_y) as f32;
                p[2] = (p[2] as f64 - rtc_z) as f32;
            }
        }
        mesh.rtc_applied = true;
        let color = [colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]];
        collection.add(crate::zero_copy::MeshDataJs::new(express_ids[i], ifc_types[i].clone(), mesh, color));
    }
    Ok(collection)
}
