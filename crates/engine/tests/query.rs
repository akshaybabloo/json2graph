mod common;

use common::{METRICS, graph};
use json2graph_engine::layout::Graph;
use json2graph_engine::parse::Kind;
use json2graph_engine::query::{
    Frame, KEY_INDEX, KEY_NAME, LABEL_INDEX, LABEL_NAME, LABEL_NONE, ROW_FIRST, ROW_WORDS, View,
    query,
};

const WIDTH: f64 = 1600.0;
const HEIGHT: f64 = 900.0;

fn view(x: f64, y: f64, k: f64) -> View {
    View {
        x,
        y,
        k,
        width: WIDTH,
        height: HEIGHT,
        text: k >= 0.4,
    }
}

fn run(g: &Graph, v: &View) -> Frame {
    let mut frame = Frame::default();
    query(g, &[], &METRICS, v, &mut frame);
    frame
}

/// A view that shows the whole graph.
fn fit(g: &Graph) -> View {
    let (w, h) = g.size();
    view(0.0, 0.0, (WIDTH / w).min(HEIGHT / h))
}

fn records(count: usize) -> String {
    let record =
        r#"{"id": 1, "name": "someone", "tags": ["a", "b"], "geo": {"lat": 1.5, "lng": 2.5}}"#;
    format!("[{}]", vec![record; count].join(","))
}

#[test]
fn small_graph_is_emitted_in_full() {
    let g = graph(r#"{"name": "Ada", "address": {"city": "Pune"}, "tags": ["a", "b"]}"#);
    let v = view(40.0, 30.0, 1.0);
    let f = run(&g, &v);

    assert_eq!(f.boxes.len(), 3 * 4);
    assert_eq!(f.edges.len(), 2 * 4);
    assert_eq!(f.far_edges.len(), 0);
    assert_eq!(f.slivers.len(), 0);
    assert_eq!(f.rows.len(), (3 + 1 + 2) * ROW_WORDS);

    // The first box is the root, at its world position moved by the view.
    let root = &g.boxes[0];
    let top = g.box_top(root, &METRICS);
    assert_eq!(
        f.boxes[..4],
        [
            40.0,
            top as f32 + 30.0,
            root.w,
            g.box_height(root, &METRICS) as f32
        ]
    );

    // Its second row is the "address" object: a named key and a child count.
    let row = &f.rows[ROW_WORDS..2 * ROW_WORDS];
    assert_eq!(f32::from_bits(row[0]), 40.0 + METRICS.pad_x as f32);
    let centre = top + METRICS.pad_y + 1.5 * METRICS.row_h;
    assert_eq!(f32::from_bits(row[1]), centre as f32 + 30.0);
    assert_eq!(row[3], Kind::Object as u32 | KEY_NAME << 8);
    // Only the first row of each box is flagged as such: one per box.
    assert_eq!(f.rows[3], Kind::String as u32 | KEY_NAME << 8 | ROW_FIRST);
    let firsts = f.rows.chunks(ROW_WORDS).filter(|r| r[3] & ROW_FIRST != 0);
    assert_eq!(firsts.count(), 3);
    assert_eq!((row[5], row[6], row[7]), (7, 1, 0));

    // Every edge runs from the right side of the root to the left side of a child.
    let kid_x = g.boxes[1].x + 40.0;
    for edge in f.edges.chunks(4) {
        assert_eq!((edge[0], edge[2]), (root.w + 40.0, kid_x));
    }
    // The edge to "address" leaves from that row.
    let to_address = f.edges.chunks(4).find(|e| e[1] == centre as f32 + 30.0);
    assert!(to_address.is_some());
}

#[test]
fn array_rows_are_keyed_by_index() {
    let g = graph("[10, 20, 30]");
    let f = run(&g, &view(0.0, 0.0, 1.0));
    let last = &f.rows[2 * ROW_WORDS..];
    assert_eq!(last[3], Kind::Number as u32 | KEY_INDEX << 8);
    assert_eq!((last[4], last[5]), (2, 0));
    // "[10, 20, 30]": the third number starts at byte 9 and is 2 bytes long.
    assert_eq!((last[6], last[7]), (9, 2));
}

#[test]
fn nothing_is_emitted_away_from_the_graph() {
    let g = graph(&records(50));
    let (w, h) = g.size();
    for v in [
        view(-w - 10.0, 0.0, 1.0),
        view(WIDTH + 10.0, 0.0, 1.0),
        view(0.0, -h - 10.0, 1.0),
        view(0.0, HEIGHT + 10.0, 1.0),
    ] {
        let f = run(&g, &v);
        let drawn = f.boxes.len() + f.slivers.len() + f.edges.len() + f.far_edges.len();
        assert_eq!(drawn + f.rows.len(), 0);
    }
}

#[test]
fn text_is_skipped_when_zoomed_out() {
    let g = graph(&records(50));
    let f = run(&g, &view(0.0, 0.0, 0.2));
    assert!(!f.boxes.is_empty());
    assert_eq!(f.rows.len(), 0);
}

#[test]
fn work_is_bounded_by_the_viewport_not_the_document() {
    let g = graph(&records(200_000));
    assert_eq!(g.boxes.len(), 1 + 200_000 * 3);

    // Fully zoomed out, hundreds of records share each pixel row.
    let f = run(&g, &fit(&g));
    let marks = (f.boxes.len() + f.slivers.len()) / 4;
    assert!(marks > 100 && marks < 3 * HEIGHT as usize, "{marks} marks");
    assert!(f.edges.len() / 4 < 3 * HEIGHT as usize);
    assert_eq!(f.rows.len(), 0);

    // Zoomed in on the middle of the children, only what fits is emitted.
    let middle = &g.boxes[100_000];
    let v = view(-(middle.x as f64) + 200.0, -middle.band_top + 100.0, 1.0);
    let f = run(&g, &v);
    let boxes = f.boxes.len() / 4;
    assert!(boxes > 3 && boxes < 200, "{boxes} boxes");
    let rows = f.rows.len() / ROW_WORDS;
    assert!(rows > 10 && rows < 2000, "{rows} rows");
}

#[test]
fn a_huge_box_emits_only_its_visible_rows() {
    let src = format!("[{}]", vec!["1"; 1_000_000].join(","));
    let g = graph(&src);
    assert_eq!(g.boxes.len(), 1);

    // Scrolled half a million rows down.
    let y = -(METRICS.pad_y + 500_000.0 * METRICS.row_h);
    let f = run(&g, &view(0.0, y, 1.0));
    let rows = f.rows.len() / ROW_WORDS;
    assert_eq!(rows, (HEIGHT / METRICS.row_h) as usize);
    assert_eq!(f.rows[4], 500_000);
    assert_eq!(f32::from_bits(f.rows[1]), METRICS.row_h as f32 / 2.0);

    // The box is clipped to the neighbourhood of the viewport.
    let (top, height) = (f.boxes[1], f.boxes[3]);
    assert!(top > -1000.0 && top + height < HEIGHT as f32 + 1000.0);
}

#[test]
fn edges_to_off_screen_children_are_sampled() {
    let g = graph(&records(200_000));
    let root = &g.boxes[0];
    // Look at the gap between the root and its children, level with the top
    // of the root: every child above the viewport has an edge crossing it.
    let top = g.box_top(root, &METRICS);
    let v = view(-(root.w as f64) + 100.0, -top + 100.0, 1.0);
    let f = run(&g, &v);
    let far = f.far_edges.len() / 4;
    assert!(far > 100 && far < 1000, "{far} far edges");
    // Edges to the children that are on screen are all there, and separate.
    let near = f.edges.len() / 4;
    assert!(near > 0 && near < 50, "{near} edges");
}

#[test]
fn boxes_never_shrink_below_a_pixel() {
    let g = graph(&records(200_000));
    let f = run(&g, &fit(&g));
    assert!(!f.boxes.is_empty());
    for rect in f.boxes.chunks(4).chain(f.slivers.chunks(4)) {
        assert!(rect[2] >= 1.0 && rect[3] >= 1.0, "{rect:?}");
    }
}

#[test]
fn deep_chains_are_walked_without_recursion() {
    let depth = 100_000;
    let g = graph(&("[".repeat(depth) + "1" + &"]".repeat(depth)));
    assert_eq!(g.boxes.len(), depth);
    let f = run(&g, &fit(&g));
    assert!(!f.boxes.is_empty());
}

#[test]
fn array_rows_carry_the_label_of_their_array() {
    let src = r#"{"tags": ["a", "b"], "matrix": [[1, 2], [3, 4]]}"#;
    let g = graph(src);
    let f = run(&g, &view(0.0, 0.0, 1.0));

    // The key of each array row, as the renderer writes it.
    let key = |row: &[u32]| {
        let label = &f.labels[row[5] as usize..][..3];
        let prefix = match label[0] {
            LABEL_NAME => src[label[1] as usize..][..label[2] as usize].to_string(),
            LABEL_INDEX => label[1].to_string(),
            _ => String::new(),
        };
        format!("{prefix}[{}]", row[4])
    };
    let keys: Vec<String> = f
        .rows
        .chunks(ROW_WORDS)
        .filter(|row| (row[3] >> 8) & 0xff == KEY_INDEX)
        .map(key)
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(
        sorted,
        [
            "0[0]",
            "0[1]",
            "1[0]",
            "1[1]",
            "matrix[0]",
            "matrix[1]",
            "tags[0]",
            "tags[1]"
        ]
    );

    // A root array has no prefix.
    let g = graph("[10, 20]");
    let f = run(&g, &view(0.0, 0.0, 1.0));
    assert_eq!(f.labels, [LABEL_NONE, 0, 0]);
}
