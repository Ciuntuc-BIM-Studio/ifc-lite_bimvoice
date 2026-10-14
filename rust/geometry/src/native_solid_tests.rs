// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use super::*;

const IDENTITY: [f64; 16] = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.];

fn volume(mesh: &Mesh) -> f64 {
    let p = |i: u32| {
        let i = i as usize * 3;
        [mesh.positions[i] as f64, mesh.positions[i + 1] as f64, mesh.positions[i + 2] as f64]
    };
    mesh.indices
        .chunks_exact(3)
        .map(|t| {
            let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
            (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
        })
        .sum::<f64>()
        .abs()
}

fn rect(w: f64, h: f64) -> Vec<f64> {
    vec![0., 4., 0., 0., w, 0., w, h, 0., h, 0.]
}

fn translated(x: f64, y: f64, z: f64) -> [f64; 16] {
    let mut m = IDENTITY;
    m[12] = x;
    m[13] = y;
    m[14] = z;
    m
}

#[test]
fn a_polygon_extrudes_to_its_volume_and_an_opening_cuts_its_own() {
    // A 4 x 0.3 wall body, 3 high, with a 1 x 1.2 window cut through it.
    let mut buf = vec![1.];
    buf.extend(rect(4., 0.3));
    buf.extend(IDENTITY);
    buf.push(3.);
    buf.push(1.);
    // The cut: 1 wide, 1 (through the 0.3 wall, overshooting) deep in plan, 1.2 high from 0.9.
    buf.extend(rect(1., 1.));
    buf.extend(translated(1.5, -0.35, 0.9));
    buf.push(1.2);
    let meshes = mesh_native_solids(&buf, TessellationQuality::Medium).unwrap();
    let mesh = meshes[0].as_ref().unwrap();
    assert!((volume(mesh) - (4. * 0.3 * 3. - 1. * 0.3 * 1.2)).abs() < 1e-4, "{}", volume(mesh));
}

#[test]
fn a_section_is_built_like_the_ifc_path_builds_it() {
    // A 0.2 x 0.4 rectangle and an I section (no fillet), 6 long.
    let mut buf = vec![2., 1., 2., 0.2, 0.4];
    buf.extend(IDENTITY);
    buf.extend([6., 0.]);
    buf.extend([2., 5., 0.2, 0.4, 0.01, 0.02, f64::NAN]);
    buf.extend(IDENTITY);
    buf.extend([6., 0.]);
    let meshes = mesh_native_solids(&buf, TessellationQuality::Medium).unwrap();
    assert!((volume(meshes[0].as_ref().unwrap()) - 0.2 * 0.4 * 6.).abs() < 1e-5);
    let i_area = 2. * 0.2 * 0.02 + (0.4 - 2. * 0.02) * 0.01;
    assert!((volume(meshes[1].as_ref().unwrap()) - i_area * 6.).abs() < 1e-5);
}

#[test]
fn a_bad_solid_fails_alone_and_a_bad_buffer_is_refused() {
    let mut buf = vec![2.];
    buf.extend(rect(1., 1.));
    buf.extend(IDENTITY);
    buf.extend([0., 0.]); // zero depth
    buf.extend(rect(1., 1.));
    buf.extend(IDENTITY);
    buf.extend([2., 0.]);
    let meshes = mesh_native_solids(&buf, TessellationQuality::Medium).unwrap();
    assert!(meshes[0].is_err());
    assert!((volume(meshes[1].as_ref().unwrap()) - 2.).abs() < 1e-6);
    assert!(mesh_native_solids(&[1., 0., 2.], TessellationQuality::Medium).is_err());
    assert!(mesh_native_solids(&[1., 42.], TessellationQuality::Medium).is_err());
}

#[test]
fn a_turned_box_wall_takes_the_box_cut_in_its_own_frame() {
    // A 4 x 0.3 x 3 wall turned 30 degrees, with a 1 x 1.2 opening placed in the wall's frame.
    let (c, s) = (30f64.to_radians().cos(), 30f64.to_radians().sin());
    let wall = [c, s, 0., 0., -s, c, 0., 0., 0., 0., 1., 0., 2., 1., 0., 1.];
    let host = Matrix4::from_column_slice(&wall);
    let cut = host * Matrix4::new_translation(&nalgebra::Vector3::new(1.5, -0.35, 0.9));
    let mut buf = vec![1.];
    buf.extend(rect(4., 0.3));
    buf.extend(wall);
    buf.extend([3., 1.]);
    buf.extend(rect(1., 1.));
    buf.extend(cut.as_slice().iter().copied());
    buf.push(1.2);
    let solid = &decode_native_solids(&buf).unwrap()[0];
    let inverse = solid.placement.try_inverse().unwrap();
    assert!(local_box(&solid.cuts[0], &inverse).is_some(), "the opening is a box in the wall's frame");
    let mesh = mesh_native_solid(solid, TessellationQuality::Medium).unwrap();
    assert!((volume(&mesh) - (4. * 0.3 * 3. - 0.3 * 1.2)).abs() < 1e-4, "{}", volume(&mesh));
    // Still turned: a corner of the base lies on the rotated axis, not on X.
    let max_y = mesh.positions.chunks_exact(3).map(|p| p[1]).fold(f32::MIN, f32::max);
    assert!(max_y > 2.9, "{max_y}");
}

#[test]
fn layers_slice_the_body_at_their_interfaces_with_the_ifc_slicer() {
    // A 4 x 0.3 x 3 wall body centred on its axis (y from -0.15), two layers stacked along +Y.
    let mut buf = vec![1., 0., 4., 0., -0.15, 4., -0.15, 4., 0.15, 0., 0.15, 0.];
    buf.extend(IDENTITY);
    buf.extend([3., 0.]);
    let solid = &decode_native_solids(&buf).unwrap()[0];
    let mesh = mesh_native_solid(solid, TessellationQuality::Medium).unwrap();
    let stack = NativeLayers {
        layers: vec![(11, 0.2), (12, 0.1)], axis: [0., 1., 0.], sense: 1., offset: -0.15, frame: Matrix4::identity(),
    };
    let parts = slice_native_layers(&mesh, &stack).unwrap();
    assert_eq!(parts.iter().map(|p| p.0).collect::<Vec<_>>(), vec![11, 12]);
    let y_range = |m: &Mesh| {
        let ys: Vec<f32> = m.positions.chunks_exact(3).map(|p| p[1]).collect();
        (ys.iter().cloned().fold(f32::MAX, f32::min), ys.iter().cloned().fold(f32::MIN, f32::max))
    };
    let (a0, a1) = y_range(&parts[0].1);
    let (b0, b1) = y_range(&parts[1].1);
    assert!((a0 + 0.15).abs() < 1e-5 && (a1 - 0.05).abs() < 1e-5, "{a0} {a1}");
    assert!((b0 - 0.05).abs() < 1e-5 && (b1 - 0.15).abs() < 1e-5, "{b0} {b1}");
    // A sub-2 mm layer merges into its neighbour: nothing left to slice.
    let thin = NativeLayers { layers: vec![(11, 0.299), (12, 0.001)], ..stack };
    assert!(slice_native_layers(&mesh, &thin).is_none());
}

/// A faces profile: `faces` loops of (x y z), no holes.
fn faces(loops: &[&[[f64; 3]]]) -> Vec<f64> {
    let mut buf = vec![100., loops.len() as f64];
    for l in loops {
        buf.extend([1., l.len() as f64]);
        for p in *l {
            buf.extend(p);
        }
    }
    buf
}

/// The six faces of the box [x0,x1]x[y0,y1] between a flat bottom z0 and a top plane z = top(x).
fn slanted_box(x: [f64; 2], y: [f64; 2], z0: f64, top: impl Fn(f64) -> f64) -> Vec<f64> {
    let p = |i: usize, j: usize, up: bool| [x[i], y[j], if up { top(x[i]) } else { z0 }];
    faces(&[
        &[p(0, 0, false), p(0, 1, false), p(1, 1, false), p(1, 0, false)],
        &[p(0, 0, true), p(1, 0, true), p(1, 1, true), p(0, 1, true)],
        &[p(0, 0, false), p(1, 0, false), p(1, 0, true), p(0, 0, true)],
        &[p(1, 0, false), p(1, 1, false), p(1, 1, true), p(1, 0, true)],
        &[p(1, 1, false), p(0, 1, false), p(0, 1, true), p(1, 1, true)],
        &[p(0, 1, false), p(0, 0, false), p(0, 0, true), p(0, 1, true)],
    ])
}

#[test]
fn faces_build_a_polyhedron_and_cut_like_a_roof_trim() {
    // A 2 x 1 x 1 box from faces, placed 3 m up.
    let mut buf = vec![1.];
    buf.extend(slanted_box([0., 2.], [0., 1.], 0., |_| 1.));
    buf.extend(translated(0., 0., 3.));
    buf.extend([0., 0.]);
    let mesh = &mesh_native_solids(&buf, TessellationQuality::Medium).unwrap()[0];
    let mesh = mesh.as_ref().unwrap();
    assert!((volume(mesh) - 2.).abs() < 1e-5, "{}", volume(mesh));
    let min_z = mesh.positions.chunks_exact(3).map(|p| p[2]).fold(f32::MAX, f32::min);
    assert!((min_z - 3.).abs() < 1e-6);

    // A 4 x 0.3 x 3 wall with the space above the plane z = 2 + x/4 taken off (a mono-pitch roof over it).
    let mut buf = vec![1.];
    buf.extend(rect(4., 0.3));
    buf.extend(IDENTITY);
    buf.extend([3., 1.]);
    // The removed prism: between the roof plane (its slanted bottom) and z = 5.
    let removed = {
        let p = |x: f64, y: f64, up: bool| [x, y, if up { 5. } else { 2. + x / 4. }];
        let (x0, x1, y0, y1) = (-0.5, 4.5, -0.5, 0.8);
        faces(&[
            &[p(x0, y0, false), p(x0, y1, false), p(x1, y1, false), p(x1, y0, false)],
            &[p(x0, y0, true), p(x1, y0, true), p(x1, y1, true), p(x0, y1, true)],
            &[p(x0, y0, false), p(x1, y0, false), p(x1, y0, true), p(x0, y0, true)],
            &[p(x1, y0, false), p(x1, y1, false), p(x1, y1, true), p(x1, y0, true)],
            &[p(x1, y1, false), p(x0, y1, false), p(x0, y1, true), p(x1, y1, true)],
            &[p(x0, y1, false), p(x0, y0, false), p(x0, y0, true), p(x0, y1, true)],
        ])
    };
    buf.extend(removed);
    buf.extend(IDENTITY);
    buf.push(0.);
    let mesh = &mesh_native_solids(&buf, TessellationQuality::Medium).unwrap()[0];
    let mesh = mesh.as_ref().unwrap();
    // Under the plane: 0.3 * integral_0^4 (2 + x/4) dx = 0.3 * (8 + 2) = 3.
    assert!((volume(mesh) - 3.).abs() < 1e-4, "{}", volume(mesh));
}

#[test]
fn a_disk_sweeps_along_its_polyline_like_the_ifc_sweep() {
    // A 0.02 m handrail, 2 m along X then 1 m up a slope, placed 1 m up.
    let mut buf = vec![1., 101., 3., 0., 0., 0., 2., 0., 0., 3., 0., 1., 0.02, f64::NAN];
    buf.extend(translated(0., 0., 1.));
    buf.extend([0., 0.]);
    let mesh = &mesh_native_solids(&buf, TessellationQuality::Medium).unwrap()[0];
    let mesh = mesh.as_ref().unwrap();
    let expected = crate::processors::mesh_swept_disk(
        &[Point3::new(0., 0., 1.), Point3::new(2., 0., 1.), Point3::new(3., 0., 2.)], 0.02, None, TessellationQuality::Medium,
    ).unwrap();
    assert_eq!(mesh.indices.len(), expected.indices.len());
    assert!((volume(mesh) - volume(&expected)).abs() < 1e-9, "{} {}", volume(mesh), volume(&expected));
    assert!(volume(mesh) > 0.0);
}
