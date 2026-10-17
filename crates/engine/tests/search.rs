mod common;

use common::METRICS;
use json2graph_engine::csv::CsvParser;
use json2graph_engine::layout::{Graph, Place};
use json2graph_engine::parse::index;
use json2graph_engine::query::{Frame, ROW_FOUND, ROW_WORDS, View, query};
use json2graph_engine::search::{Needle, search};

const DOC: &str = r#"{"Name": "json2graph", "tags": ["graph", {"deep": "Graphs"}], "n": 7, "nested": {"name": null}}"#;

fn graph(src: &str) -> Graph {
    let mut graph = Graph::from_index(index(src.as_bytes()).unwrap());
    graph.layout(&METRICS);
    graph
}

/// The source of each row found, key and all.
fn found(src: &str, graph: &Graph, text: &str, match_case: bool) -> Vec<String> {
    search(graph, src.as_bytes(), &Needle::new(text, match_case))
        .into_iter()
        .map(|place| {
            let (start, end) = graph.extent(place).unwrap();
            src[start as usize..end as usize].to_owned()
        })
        .collect()
}

#[test]
fn keys_and_values_are_found_in_the_order_they_are_read() {
    let g = graph(DOC);
    assert_eq!(
        found(DOC, &g, "graph", false),
        [
            r#""Name": "json2graph""#,
            r#""graph""#,
            r#""deep": "Graphs""#
        ]
    );
    // By their keys too, and at any depth.
    assert_eq!(
        found(DOC, &g, "name", false),
        [r#""Name": "json2graph""#, r#""name": null"#]
    );
}

#[test]
fn case_matters_only_when_asked() {
    let g = graph(DOC);
    assert_eq!(found(DOC, &g, "Graph", true), [r#""deep": "Graphs""#]);
    assert_eq!(found(DOC, &g, "GRAPH", false).len(), 3);
    let src = r#"{"Straße": "ÜBER"}"#;
    let g = graph(src);
    assert_eq!(found(src, &g, "über", false), [r#""Straße": "ÜBER""#]);
    assert_eq!(found(src, &g, "straße", false).len(), 1);
}

#[test]
fn values_are_found_as_they_are_shown() {
    let g = graph(DOC);
    // Strings with their quotes, numbers and literals as written.
    assert_eq!(found(DOC, &g, r#""graph""#, false), [r#""graph""#]);
    assert_eq!(found(DOC, &g, "7", false), [r#""n": 7"#]);
    assert_eq!(found(DOC, &g, "null", false), [r#""name": null"#]);
    // Not the `[index]` of an element, nor the count of an object or array.
    assert_eq!(found(DOC, &g, "[0]", false), Vec::<String>::new());
    assert_eq!(found(DOC, &g, "{1}", false), Vec::<String>::new());
    assert_eq!(found(DOC, &g, "", false), Vec::<String>::new());
}

#[test]
fn unicode_escapes_are_read_as_their_characters() {
    let src = r#"["café", "😀 smile", "a\\u00e9", "tab\u0009"]"#;
    let g = graph(src);
    assert_eq!(found(src, &g, "café", false), [r#""café""#]);
    assert_eq!(found(src, &g, "😀 s", false), [r#""😀 smile""#]);
    // An escaped backslash starts no escape, and a control character is shown as written.
    assert_eq!(found(src, &g, r"\\u00e9", false), [r#""a\\u00e9""#]);
    assert_eq!(found(src, &g, r"\u0009", false), [r#""tab\u0009""#]);
}

#[test]
fn the_rows_found_are_marked_where_they_are_drawn() {
    let mut g = graph(DOC);
    let places = search(&g, DOC.as_bytes(), &Needle::new("graph", false));
    g.set_found(&places);
    let view = View {
        x: 0.0,
        y: 0.0,
        k: 1.0,
        width: 4000.0,
        height: 4000.0,
        text: true,
    };
    let mut frame = Frame::default();
    query(&g, DOC.as_bytes(), &METRICS, &view, &mut frame);
    let marked = frame
        .rows
        .chunks(ROW_WORDS)
        .filter(|row| row[3] & ROW_FOUND != 0)
        .count();
    assert_eq!(marked, 3);

    g.set_found(&[]);
    query(&g, DOC.as_bytes(), &METRICS, &view, &mut frame);
    assert!(
        frame
            .rows
            .chunks(ROW_WORDS)
            .all(|row| row[3] & ROW_FOUND == 0)
    );
}

#[test]
fn a_row_in_collapsed_boxes_is_shown_by_opening_them() {
    let mut g = graph(DOC);
    let place: Place = search(&g, DOC.as_bytes(), &Needle::new("deep", false))[0];
    let tags = g.values[g.boxes[0].first as usize + 1].a;
    let deep = place.0;
    g.toggle_box(&METRICS, deep);
    g.toggle_box(&METRICS, tags);
    assert_eq!(g.shown(place), (0, Some(1)));

    assert!(g.expand_to(&METRICS, deep));
    assert_eq!(g.shown(place), place);
    assert!(!g.is_collapsed(tags) && !g.is_collapsed(deep));
    assert!(!g.expand_to(&METRICS, deep));
}

#[test]
fn csv_fields_are_found_by_their_column_or_their_text() {
    let src = "name,city\nAda,London\n\"Grace, H\",Arlington\n";
    let mut parser = CsvParser::new(b',');
    assert!(parser.step(src.as_bytes(), usize::MAX).unwrap());
    let mut g = Graph::from_index(parser.index());
    g.layout(&METRICS);
    let text = |text: &str| {
        search(&g, src.as_bytes(), &Needle::new(text, false))
            .into_iter()
            .map(|place| {
                let (start, end) = g.source_range(place).unwrap();
                &src[start as usize..end as usize]
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(text("ON"), ["London", "Arlington"]);
    assert_eq!(text("grace, h"), ["Grace, H"]);
    // Each record's field of the column of that name.
    assert_eq!(text("city"), ["London", "Arlington"]);
}
