mod common;

use common::{METRICS, graph};
use json2graph_engine::layout::Graph;
use json2graph_engine::query::{Frame, ROW_WORDS, View, query, query_path};

/// Boxes, breadth first: the root, `a`, then `c` and `d` inside `a`.
const NESTED: &str = r#"{"a": {"c": {"x": 1}, "d": {"y": 2, "z": 3}}}"#;
const C: u32 = 2;
const D: u32 = 3;

fn view(x: f64, y: f64) -> View {
    View {
        x,
        y,
        k: 1.0,
        width: 1600.0,
        height: 900.0,
        text: true,
    }
}

fn path(g: &Graph, v: &View, target: u32) -> Frame {
    let mut frame = Frame::default();
    query_path(g, &[], &METRICS, v, target, &mut frame);
    frame
}

/// World position of the middle of a box.
fn centre(g: &Graph, id: u32) -> (f64, f64) {
    let b = &g.boxes[id as usize];
    let y = g.box_top(b, &METRICS) + g.box_height(b, &METRICS) / 2.0;
    (b.x as f64 + b.w as f64 / 2.0, y)
}

#[test]
fn path_is_the_box_and_its_ancestors() {
    let g = graph(NESTED);
    let v = view(40.0, 30.0);

    // To `c`: the root, `a` and `c`, but not its sibling `d`.
    let f = path(&g, &v, C);
    assert_eq!(f.boxes.len(), 3 * 4);
    assert_eq!(f.edges.len(), 2 * 4);
    assert_eq!(f.rows.len(), (1 + 2 + 1) * ROW_WORDS);
    assert_eq!(f.far_edges.len() + f.slivers.len(), 0);

    let f = path(&g, &v, D);
    assert_eq!(f.rows.len(), (1 + 2 + 2) * ROW_WORDS);

    // The root is its own path.
    let f = path(&g, &v, 0);
    assert_eq!(f.boxes.len(), 4);
    assert_eq!(f.edges.len(), 0);
}

#[test]
fn path_draws_what_the_full_query_draws() {
    let g = graph(NESTED);
    let v = view(40.0, 30.0);
    let mut all = Frame::default();
    query(&g, &[], &METRICS, &v, &mut all);
    let f = path(&g, &v, C);

    // Every box and edge of the path is one of the full frame, unchanged.
    let boxes: Vec<&[f32]> = all.boxes.chunks(4).collect();
    let edges: Vec<&[f32]> = all.edges.chunks(4).collect();
    assert_eq!((boxes.len(), edges.len()), (4, 3));
    assert!(f.boxes.chunks(4).all(|b| boxes.contains(&b)));
    assert!(f.edges.chunks(4).all(|e| edges.contains(&e)));

    // The target comes first, then its ancestors up to the root.
    let left: Vec<f32> = f.boxes.chunks(4).map(|b| b[0]).collect();
    assert!(left.is_sorted_by(|a, b| a > b));
}

#[test]
fn path_edge_is_kept_when_its_boxes_are_off_screen() {
    let g = graph(NESTED);
    let a = &g.boxes[1];
    // The viewport starts in the gap between `a` and its children and ends
    // before them, so no box of the path is in it.
    let gap = a.x as f64 + a.w as f64 + METRICS.gap_x / 2.0;
    let mut v = view(-gap, 30.0);
    v.width = METRICS.gap_x / 4.0;

    let f = path(&g, &v, C);
    assert_eq!(f.boxes.len(), 0);
    assert_eq!(f.edges.len(), 4);
}

#[test]
fn box_at_finds_a_box_by_any_point_inside_it() {
    let g = graph(NESTED);
    for id in 0..4 {
        let (x, y) = centre(&g, id);
        assert_eq!(g.box_at(&METRICS, x, y), Some(id));
    }

    // The padding around the rows belongs to the box, though it is not a row.
    let c = &g.boxes[C as usize];
    let (x, top) = (c.x as f64 + 1.0, g.box_top(c, &METRICS));
    assert_eq!(g.box_at(&METRICS, x, top + 1.0), Some(C));
    assert_eq!(g.hit(&METRICS, x, top + 1.0), None);

    // Between two columns, and between `c` and `d`, there is nothing.
    assert_eq!(g.box_at(&METRICS, c.x as f64 - 1.0, top + 1.0), None);
    let d = &g.boxes[D as usize];
    let between = (top + g.box_height(c, &METRICS) + g.box_top(d, &METRICS)) / 2.0;
    assert_eq!(g.box_at(&METRICS, x, between), None);
}

#[test]
fn unknown_target_draws_nothing() {
    let g = graph(NESTED);
    let f = path(&g, &view(40.0, 30.0), 99);
    assert_eq!(f.boxes.len() + f.edges.len() + f.rows.len(), 0);
}
