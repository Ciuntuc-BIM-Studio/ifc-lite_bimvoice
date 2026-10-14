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
