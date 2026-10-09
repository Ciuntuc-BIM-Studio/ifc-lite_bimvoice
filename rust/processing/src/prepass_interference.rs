// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! `IfcRelInterferesElements` in the pre-pass void index: with ImpliedOrder
//! TRUE the RelatedElement is subtracted from the RelatingElement (a wall
//! cut by a column), so the mesher cuts it like an opening of the relating
//! element. FALSE / UNKNOWN name no priority and cut nothing. The relations
//! ride the void spans (same scan class), told apart here by type.

use ifc_lite_core::{DecodedEntity, IfcType};
use rustc_hash::FxHashMap;

pub(crate) fn is_interference(entity: &DecodedEntity) -> bool {
    entity.ifc_type == IfcType::IfcRelInterferesElements
}

/// Record the cut `entity` implies: ImpliedOrder is the last attribute in
/// IFC4 and IFC4X3 alike (IFC4X3 inserts InterferenceSpace before it).
pub(crate) fn record_cut(entity: &DecodedEntity, void_index: &mut FxHashMap<u32, Vec<u32>>) {
    let implied = entity.attributes.last().and_then(|v| v.as_enum()).is_some_and(|v| v.eq_ignore_ascii_case("T"));
    if let (true, Some(cut), Some(cutter)) = (implied, entity.get_ref(4), entity.get_ref(5)) {
        if cutter != cut {
            void_index.entry(cut).or_default().push(cutter);
        }
    }
}
