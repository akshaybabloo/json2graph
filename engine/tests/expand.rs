mod common;

use common::{METRICS, graph};
use json2graph_engine::layout::Graph;
use json2graph_engine::query::{
    Frame, ROW_CONTINUED, ROW_MORE, ROW_WORDS, ROW_WRAPPED, View, query,
};
use json2graph_engine::wrap::MAX_LINES;

/// A root object whose second row holds a 200-character string, between two
/// rows that lead to child boxes.
fn document() -> String {
    format!(
        r#"{{"first": {{"a": 1}}, "long": "{}", "last": {{"b": 2}}, "short": "ok"}}"#,
        "0123456789".repeat(20)
    )
}

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

/// Centre of a row of the root box, in world coordinates.
fn row_centre(g: &Graph, row: u32) -> (f64, f64) {
    let root = &g.boxes[0];
    let y = g.row_top(root, row, &METRICS) + METRICS.row_h / 2.0;
    (root.w as f64 / 2.0, y)
}

#[test]
fn hit_finds_the_box_and_row() {
    let g = graph(&document());
    for row in 0..4 {
        let (x, y) = row_centre(&g, row);
        assert_eq!(g.hit(&METRICS, x, y), Some((0, row)));
    }
    // The second child, through its parent's band.
    let child = &g.boxes[2];
    let (x, y) = (child.x as f64 + 5.0, g.row_top(child, 0, &METRICS) + 1.0);
    assert_eq!(g.hit(&METRICS, x, y), Some((2, 0)));

    // The padding of a box, the gap between boxes and empty space are misses.
    let root_top = g.box_top(&g.boxes[0], &METRICS);
    assert_eq!(g.hit(&METRICS, 5.0, root_top + 1.0), None);
    assert_eq!(g.hit(&METRICS, child.x as f64 - 5.0, y), None);
    assert_eq!(g.hit(&METRICS, -1.0, y), None);
    assert_eq!(g.hit(&METRICS, 1e6, y), None);
    assert_eq!(g.hit(&METRICS, x, -50.0), None);
}

#[test]
fn only_values_that_are_cut_short_can_be_expanded() {
    let src = document();
    let mut g = graph(&src);
    assert!(!g.is_expandable(&METRICS, 0, 0), "a container");
    assert!(g.is_expandable(&METRICS, 0, 1), "the long string");
    assert!(!g.is_expandable(&METRICS, 0, 3), "a short string");
    assert_eq!(g.toggle(src.as_bytes(), &METRICS, 0, 0), None);
    assert_eq!(g.toggle(src.as_bytes(), &METRICS, 0, 3), None);
    assert_eq!(g.line_count(&g.boxes[0]), 4);
}

#[test]
fn expanding_wraps_the_value_and_grows_the_box() {
    let src = document();
    let mut g = graph(&src);
    let before = g.box_height(&g.boxes[0], &METRICS);
    let row_before = g.row_top(&g.boxes[0], 1, &METRICS);

    // The value is 202 bytes with its quotes; beside the key there is room
    // for max_val (48) columns, so it takes 5 lines.
    assert_eq!(g.value_cols(&g.boxes[0], 1, &METRICS), METRICS.max_val);
    let moved = g.toggle(src.as_bytes(), &METRICS, 0, 1).unwrap();
    let root = &g.boxes[0];
    assert_eq!(g.line_count(root), 4 + 4);
    assert_eq!(g.box_height(root, &METRICS), before + 4.0 * METRICS.row_h);
    assert_eq!(g.row_top(root, 1, &METRICS), row_before + moved);
    assert!(
        g.is_expandable(&METRICS, 0, 1),
        "so that it can be collapsed"
    );

    // Rows below the expanded one start further down; rows above do not.
    assert_eq!(g.row_line(root, 0), 0);
    assert_eq!(g.row_line(root, 1), 1);
    assert_eq!(g.row_line(root, 2), 6);
    assert_eq!(g.row_line(root, 3), 7);

    // Every line of the expanded value belongs to its row.
    let x = root.w as f64 / 2.0;
    let top = g.row_top(root, 1, &METRICS);
    for line in 0..5 {
        let y = top + (line as f64 + 0.5) * METRICS.row_h;
        assert_eq!(g.hit(&METRICS, x, y), Some((0, 1)));
    }
    let (x, y) = row_centre(&g, 2);
    assert_eq!(g.hit(&METRICS, x, y), Some((0, 2)));
}

#[test]
fn expanded_lines_are_emitted_as_rows() {
    let src = document();
    let mut g = graph(&src);
    g.toggle(src.as_bytes(), &METRICS, 0, 1).unwrap();
    let f = frame(&g, &src);

    // The root's rows come first: 1 + 5 + 1 + 1 lines.
    let lines: Vec<&[u32]> = f.rows.chunks(ROW_WORDS).take(8).collect();
    let wrapped: Vec<&[u32]> = lines[1..6].to_vec();
    let text: String = wrapped
        .iter()
        .map(|row| &src[row[6] as usize..(row[6] + row[7]) as usize])
        .collect();
    assert_eq!(text, format!("\"{}\"", "0123456789".repeat(20)));

    for (n, row) in wrapped.iter().enumerate() {
        assert_ne!(row[3] & ROW_WRAPPED, 0);
        assert_eq!(row[3] & ROW_CONTINUED != 0, n > 0);
        assert_eq!(row[3] & ROW_MORE, 0);
        // Every line carries the key, so the renderer can align it.
        assert_eq!(&src[row[4] as usize..(row[4] + row[5]) as usize], "long");
    }
    for row in [lines[0], lines[6], lines[7]] {
        assert_eq!(row[3] & (ROW_WRAPPED | ROW_CONTINUED), 0);
    }

    // Lines are one row height apart, top to bottom.
    let ys: Vec<f32> = lines.iter().map(|row| f32::from_bits(row[1])).collect();
    for pair in ys.windows(2) {
        assert_eq!(pair[1] - pair[0], METRICS.row_h as f32);
    }

    // The edge to "last" leaves from its row, below the expanded lines.
    let last_y = f32::from_bits(lines[6][1]);
    assert!(f.edges.chunks(4).any(|edge| edge[1] == last_y));
}

#[test]
fn only_the_visible_lines_of_an_expanded_value_are_emitted() {
    let src = document();
    let mut g = graph(&src);
    g.toggle(src.as_bytes(), &METRICS, 0, 1).unwrap();
    let root = &g.boxes[0];

    // A viewport one and a half rows tall, starting at the third wrapped line.
    let top = g.row_top(root, 1, &METRICS) + 2.0 * METRICS.row_h;
    let view = View {
        x: 0.0,
        y: -top,
        k: 1.0,
        width: root.w as f64,
        height: 1.5 * METRICS.row_h,
        text: true,
    };
    let mut f = Frame::default();
    query(&g, src.as_bytes(), &METRICS, &view, &mut f);
    let rows: Vec<&[u32]> = f.rows.chunks(ROW_WORDS).collect();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row[3] & ROW_CONTINUED != 0));
    assert_eq!(f32::from_bits(rows[0][1]), METRICS.row_h as f32 / 2.0);
}

#[test]
fn collapsing_restores_the_layout() {
    let src = document();
    let mut g = graph(&src);
    let original: Vec<(f64, f64)> = g.boxes.iter().map(|b| (b.band_top, b.band_h)).collect();

    let down = g.toggle(src.as_bytes(), &METRICS, 0, 1).unwrap();
    let expanded: Vec<(f64, f64)> = g.boxes.iter().map(|b| (b.band_top, b.band_h)).collect();
    assert_ne!(original, expanded);

    let back = g.toggle(src.as_bytes(), &METRICS, 0, 1).unwrap();
    let collapsed: Vec<(f64, f64)> = g.boxes.iter().map(|b| (b.band_top, b.band_h)).collect();
    assert_eq!(original, collapsed);
    assert_eq!(down, -back);
    assert_eq!(g.line_count(&g.boxes[0]), 4);
}

#[test]
fn a_huge_value_is_cut_at_the_line_limit() {
    let src = format!(r#"["{}"]"#, "x".repeat(100_000));
    let mut g = graph(&src);
    g.toggle(src.as_bytes(), &METRICS, 0, 0).unwrap();
    assert_eq!(g.line_count(&g.boxes[0]), MAX_LINES as u64);

    let view = View {
        x: 0.0,
        y: 0.0,
        k: 1.0,
        width: 2000.0,
        height: 1e6,
        text: true,
    };
    let mut f = Frame::default();
    query(&g, src.as_bytes(), &METRICS, &view, &mut f);
    let rows: Vec<&[u32]> = f.rows.chunks(ROW_WORDS).collect();
    assert_eq!(rows.len(), MAX_LINES as usize);
    assert_ne!(rows.last().unwrap()[3] & ROW_MORE, 0);
    assert!(
        rows[..rows.len() - 1]
            .iter()
            .all(|row| row[3] & ROW_MORE == 0)
    );
}
