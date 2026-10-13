mod common;

use common::{METRICS, graph};
use json2graph_engine::layout::Graph;
use json2graph_engine::query::{Frame, ROW_COLLAPSED, ROW_WORDS, View, query};

/// A root object (box 0) whose rows lead to the boxes of `a` (1) and `b` (2),
/// with a number and an empty array between them. `a` holds one more box, `q`
/// (3).
const DOCUMENT: &str = r#"{"a": {"p": 1, "q": {"r": 2}}, "n": 5, "e": [], "b": {"s": 3}}"#;

fn frame(g: &Graph, src: &str) -> Frame {
    let view = View {
        x: 0.0,
        y: 0.0,
        k: 1.0,
        width: 4000.0,
        height: 4000.0,
        text: true,
    };
    let mut frame = Frame::default();
    query(g, src.as_bytes(), &METRICS, &view, &mut frame);
    frame
}

/// The middle of the control of `row` of box `id`, on the right edge of the
/// box.
fn control(g: &Graph, id: u32, row: u32) -> (f64, f64) {
    let b = &g.boxes[id as usize];
    let y = g.row_top(b, row, &METRICS) + METRICS.row_h / 2.0;
    (b.x as f64 + b.w as f64, y)
}

/// Where every box is, for comparing two layouts.
fn places(g: &Graph) -> Vec<(f64, f64, f32, f32)> {
    let place = |b: &json2graph_engine::layout::BoxRec| (b.band_top, b.band_h, b.x, b.sub_right);
    g.boxes.iter().map(place).collect()
}

/// The flags of the rows of a frame.
fn flags(f: &Frame) -> Vec<u32> {
    f.rows.chunks(ROW_WORDS).map(|row| row[3]).collect()
}

#[test]
fn the_control_is_on_the_edge_of_a_row_that_leads_to_a_box() {
    let g = graph(DOCUMENT);
    let (x, y) = control(&g, 0, 0);
    assert_eq!(g.collapsible_at(&METRICS, x, y), Some(1));
    // Half of it is inside the box and half outside, and no more.
    let half = METRICS.toggle_w / 2.0;
    assert_eq!(g.collapsible_at(&METRICS, x - half + 1.0, y), Some(1));
    assert_eq!(g.collapsible_at(&METRICS, x + half - 1.0, y), Some(1));
    assert_eq!(g.collapsible_at(&METRICS, x - half - 1.0, y), None);
    assert_eq!(g.collapsible_at(&METRICS, x + half + 1.0, y), None);

    // A number and an empty array have no box to collapse.
    for row in [1, 2] {
        let (x, y) = control(&g, 0, row);
        assert_eq!(g.collapsible_at(&METRICS, x, y), None);
    }
    let (x, y) = control(&g, 0, 3);
    assert_eq!(g.collapsible_at(&METRICS, x, y), Some(2));
    let (x, y) = control(&g, 1, 1);
    assert_eq!(g.collapsible_at(&METRICS, x, y), Some(3));
}

#[test]
fn collapsing_hides_the_box_and_its_descendants() {
    let mut g = graph(DOCUMENT);
    let before = frame(&g, DOCUMENT);
    assert_eq!(before.boxes.len() / 4, 4);
    assert_eq!(before.edges.len() / 4, 3);
    assert!(flags(&before).iter().all(|f| f & ROW_COLLAPSED == 0));
    let a = &g.boxes[1];
    let inside_a = (a.x as f64 + 5.0, g.box_top(a, &METRICS) + 5.0);
    assert_eq!(g.box_at(&METRICS, inside_a.0, inside_a.1), Some(1));

    assert!(g.toggle_box(&METRICS, 1).is_some());
    assert!(g.is_collapsed(1));
    // The root and `b` are left, with the one edge between them. `b` now
    // starts where the collapsed box does, and is still drawn.
    let after = frame(&g, DOCUMENT);
    assert_eq!(after.boxes.len() / 4, 2);
    assert_eq!(after.edges.len() / 4, 1);
    assert_eq!(g.box_at(&METRICS, inside_a.0, inside_a.1), None);
    let b = &g.boxes[2];
    let inside_b = (b.x as f64 + 5.0, g.box_top(b, &METRICS) + 5.0);
    assert_eq!(g.box_at(&METRICS, inside_b.0, inside_b.1), Some(2));

    // Only the row of `a` says that its box is collapsed.
    let collapsed: Vec<bool> = flags(&after)
        .iter()
        .map(|f| f & ROW_COLLAPSED != 0)
        .collect();
    assert_eq!(collapsed, [true, false, false, false, false]);
}

#[test]
fn the_boxes_that_are_left_close_up() {
    let mut g = graph(DOCUMENT);
    let (width, height) = g.size();
    g.toggle_box(&METRICS, 1);
    // `q` was the box furthest right, and `a` with it the tallest band.
    let b = &g.boxes[2];
    assert_eq!(g.size().0, (b.x + b.w) as f64);
    assert!(g.size().0 < width);
    assert!(g.size().1 < height);
    assert_eq!(g.size().1, g.box_height(&g.boxes[0], &METRICS));

    // The gap of a collapsed box goes with it.
    let src = r#"{"x": {"a": 1}, "y": {"b": 1}, "z": {"c": 1}}"#;
    let mut g = graph(src);
    g.toggle_box(&METRICS, 2);
    let (x, z) = (&g.boxes[1], &g.boxes[3]);
    assert_eq!(z.band_top, x.band_top + x.band_h + METRICS.gap_y);
    assert_eq!(g.size().1, x.band_h + METRICS.gap_y + z.band_h);
    assert_eq!(frame(&g, src).boxes.len() / 4, 3);
}

#[test]
fn showing_a_box_again_restores_the_layout() {
    let mut g = graph(DOCUMENT);
    let before = places(&g);
    g.toggle_box(&METRICS, 1);
    assert_ne!(places(&g), before);
    g.toggle_box(&METRICS, 1);
    assert!(!g.is_collapsed(1));
    assert_eq!(places(&g), before);
    assert_eq!(frame(&g, DOCUMENT).boxes.len() / 4, 4);
}

#[test]
fn a_box_collapsed_inside_another_stays_collapsed() {
    let mut g = graph(DOCUMENT);
    g.toggle_box(&METRICS, 3);
    assert_eq!(frame(&g, DOCUMENT).boxes.len() / 4, 3);
    g.toggle_box(&METRICS, 1);
    assert_eq!(frame(&g, DOCUMENT).boxes.len() / 4, 2);
    g.toggle_box(&METRICS, 1);
    assert!(g.is_collapsed(3));
    assert_eq!(frame(&g, DOCUMENT).boxes.len() / 4, 3);
}

#[test]
fn toggling_reports_how_far_the_row_moved() {
    let mut g = graph(DOCUMENT);
    let before = g.row_top(&g.boxes[0], 0, &METRICS);
    let moved = g.toggle_box(&METRICS, 1).unwrap();
    assert_ne!(moved, 0.0);
    assert_eq!(g.row_top(&g.boxes[0], 0, &METRICS), before + moved);
    assert_eq!(g.toggle_box(&METRICS, 1), Some(-moved));

    // The root has no row to collapse into.
    assert_eq!(g.toggle_box(&METRICS, 0), None);
    assert!(!g.is_collapsed(0));
}

#[test]
fn every_box_can_be_collapsed_or_shown_at_once() {
    let mut g = graph(DOCUMENT);
    let before = places(&g);
    g.set_all_collapsed(&METRICS, true);
    assert!(!g.is_collapsed(0));
    assert_eq!(frame(&g, DOCUMENT).boxes.len() / 4, 1);
    let root = &g.boxes[0];
    assert_eq!(g.size(), (root.w as f64, g.box_height(root, &METRICS)));

    // A box shown from there still has its own boxes collapsed.
    g.toggle_box(&METRICS, 1);
    assert_eq!(frame(&g, DOCUMENT).boxes.len() / 4, 2);
    assert!(g.is_collapsed(3));

    g.set_all_collapsed(&METRICS, false);
    assert_eq!(places(&g), before);
    assert_eq!(frame(&g, DOCUMENT).boxes.len() / 4, 4);
}

#[test]
fn a_run_of_collapsed_boxes_is_stepped_over_to_the_next_one_shown() {
    // An array of a thousand objects, boxes 1 to 1000, of which only two are
    // shown: one after a long run of collapsed boxes, and the last.
    let src = format!("[{}]", vec![r#"{"a": 1}"#; 1000].join(","));
    let mut g = graph(&src);
    g.set_all_collapsed(&METRICS, true);
    for id in [701, 1000] {
        g.toggle_box(&METRICS, id);
    }

    let root = &g.boxes[0];
    assert_eq!(g.shown_from(root, 0), 700);
    assert_eq!(g.shown_from(root, 700), 700);
    assert_eq!(g.shown_from(root, 701), 999);
    assert_eq!(g.shown_from(root, 1000), 1000);
    // With the last box collapsed as well, the run goes on to the end.
    g.toggle_box(&METRICS, 1000);
    assert_eq!(g.shown_from(&g.boxes[0], 701), 1000);
    g.toggle_box(&METRICS, 1000);

    // Both are drawn, with their edges, and found under the pointer. They are
    // half way down the root, which is far taller than the two of them.
    let view = View {
        x: 0.0,
        y: 2000.0 - g.boxes[701].band_top,
        k: 1.0,
        width: 4000.0,
        height: 4000.0,
        text: true,
    };
    let mut frame = Frame::default();
    query(&g, src.as_bytes(), &METRICS, &view, &mut frame);
    assert_eq!(frame.boxes.len() / 4, 3);
    assert_eq!(frame.edges.len() / 4, 2);
    for id in [701, 1000] {
        let b = &g.boxes[id as usize];
        let inside = (b.x as f64 + 5.0, g.box_top(b, &METRICS) + 5.0);
        assert_eq!(g.box_at(&METRICS, inside.0, inside.1), Some(id));
    }
}
