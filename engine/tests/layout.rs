mod common;

use common::{METRICS, graph};
use json2graph_engine::layout::Prefix;

#[test]
fn boxes_are_breadth_first_with_contiguous_children() {
    let g = graph(r#"{"a": {"x": {"deep": 1}}, "n": 1, "b": [1, 2], "empty": {}, "c": {"y": 2}}"#);
    assert_eq!(g.boxes.len(), 5);
    let root = &g.boxes[0];
    assert_eq!((root.child_first, root.child_count), (1, 3));
    // The row a child hangs off is its entry's position among the parent's rows.
    let rows: Vec<u32> = g
        .children(root)
        .iter()
        .map(|c| c.entry - root.first)
        .collect();
    assert_eq!(rows, [0, 2, 4]);
    assert_eq!(g.boxes[4].parent, 1);
    // Container rows point at their box.
    assert_eq!(g.rows(root)[2].a, 2);
    assert!(g.is_array(&g.boxes[2]) && !g.is_array(&g.boxes[1]));
}

#[test]
fn bare_root_gets_a_single_row_box() {
    for src in ["42", "\"text\"", "[]", "{}"] {
        let g = graph(src);
        assert_eq!(g.boxes.len(), 1);
        assert_eq!(g.row_count(&g.boxes[0]), 1);
        assert_eq!(g.size().1, METRICS.row_h + 2.0 * METRICS.pad_y);
    }
}

#[test]
fn width_follows_the_longest_row() {
    let g = graph(r#"{"k": 1, "longer_key": "0123456789"}"#);
    // "longer_key" (10) + ": " (2) + "\"0123456789\"" (12)
    assert_eq!(
        g.boxes[0].w as f64,
        2.0 * METRICS.pad_x + 24.0 * METRICS.char_w
    );

    // Long values are capped, and array rows are keyed by their index: `[0]: `.
    let g = graph(&format!(r#"["{}"]"#, "x".repeat(500)));
    let chars = 3 + 2 + METRICS.max_val;
    assert_eq!(
        g.boxes[0].w as f64,
        2.0 * METRICS.pad_x + chars as f64 * METRICS.char_w
    );
}

#[test]
fn bands_nest_and_never_overlap() {
    let g = graph(
        r#"{"a": {"p": [1, 2, 3, {"q": {"r": 1}}], "s": {"t": 1}}, "b": [{"u": 1}, {"v": [1, 2]}],
		    "c": 1, "d": 2, "e": 3, "f": 4, "g": 5, "h": 6, "i": {"w": 1}}"#,
    );
    for b in &g.boxes {
        let top = g.box_top(b, &METRICS);
        assert!(top >= b.band_top && top + g.box_height(b, &METRICS) <= b.band_top + b.band_h);

        let kids = g.children(b);
        for kid in kids {
            assert_eq!(kid.x, b.x + b.w + METRICS.gap_x as f32);
            assert!(kid.band_top >= b.band_top);
            assert!(kid.band_top + kid.band_h <= b.band_top + b.band_h + 1e-9);
            assert!(kid.sub_right <= b.sub_right);
        }
        for pair in kids.windows(2) {
            let gap = pair[1].band_top - (pair[0].band_top + pair[0].band_h);
            assert!((gap - METRICS.gap_y).abs() < 1e-9);
        }
    }
    let (width, height) = g.size();
    assert!(width > 0.0 && height == g.boxes[0].band_h);
}

#[test]
fn array_rows_are_prefixed_with_the_key_of_their_array() {
    let src = r#"{"tags": ["a"], "matrix": [[1, 2], [3, [4]]]}"#;
    let g = graph(src);
    let name = |prefix: Prefix| match prefix {
        Prefix::Name(offset, len) => &src[offset as usize..][..len as usize],
        _ => panic!("{prefix:?} is not a name"),
    };
    // Boxes, breadth first: root, tags, matrix, then matrix's two elements
    // and the array inside the second of them.
    assert_eq!(g.boxes.len(), 6);
    assert_eq!(name(g.array_prefix(&g.boxes[1])), "tags");
    assert_eq!(name(g.array_prefix(&g.boxes[2])), "matrix");
    // A nested array is known by its index, not by the whole path.
    assert_eq!(g.array_prefix(&g.boxes[3]), Prefix::Index(0));
    assert_eq!(g.array_prefix(&g.boxes[4]), Prefix::Index(1));
    assert_eq!(g.array_prefix(&g.boxes[5]), Prefix::Index(1));

    // The widths fit `tags[0]: "a"` and `0[1]: 2`.
    let width = |chars: u32| 2.0 * METRICS.pad_x + chars as f64 * METRICS.char_w;
    assert_eq!(g.boxes[1].w as f64, width(4 + 3 + 2 + 3));
    assert_eq!(g.boxes[3].w as f64, width(1 + 3 + 2 + 1));
}

#[test]
fn the_root_array_has_no_prefix() {
    let g = graph("[[1], [2]]");
    assert_eq!(g.array_prefix(&g.boxes[0]), Prefix::None);
    assert_eq!(g.array_prefix(&g.boxes[2]), Prefix::Index(1));
}
