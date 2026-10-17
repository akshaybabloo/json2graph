mod common;

use common::METRICS;
use json2graph_engine::csv::CsvParser;
use json2graph_engine::layout::{Graph, Place};
use json2graph_engine::parse::{Parser, index};

const DOC: &str = r#"{"name": "json2graph", "tags": [1, {"deep": true}, []], "empty": {}, "n": 7}"#;

fn graph(src: &str) -> Graph {
    let mut graph = Graph::from_index(index(src.as_bytes()).unwrap());
    graph.layout(&METRICS);
    graph
}

fn csv_graph(src: &str) -> Graph {
    let mut parser = CsvParser::new(b',');
    assert!(parser.step(src.as_bytes(), usize::MAX).unwrap());
    let mut graph = Graph::from_index(parser.index());
    graph.layout(&METRICS);
    graph
}

/// The text of the source that a place leads to.
fn text<'a>(src: &'a str, graph: &Graph, place: Place) -> &'a str {
    let (start, end) = graph.source_range(place).unwrap();
    &src[start as usize..end as usize]
}

/// The place of the row whose key and value in the source start with `prefix`.
fn row(src: &str, graph: &Graph, prefix: &str) -> Place {
    (0..graph.boxes.len() as u32)
        .flat_map(|id| {
            (0..graph.row_count(&graph.boxes[id as usize])).map(move |row| (id, Some(row)))
        })
        .find(|&place| {
            let (start, end) = graph.extent(place).unwrap();
            src[start as usize..end as usize].starts_with(prefix)
        })
        .unwrap_or_else(|| panic!("no row starts with {prefix}"))
}

#[test]
fn rows_lead_to_their_value_and_boxes_to_their_brackets() {
    let g = graph(DOC);
    assert_eq!(text(DOC, &g, (0, None)), DOC);
    assert_eq!(text(DOC, &g, (0, Some(0))), r#""json2graph""#);
    // An array or object in a row: all of it.
    assert_eq!(text(DOC, &g, (0, Some(1))), r#"[1, {"deep": true}, []]"#);
    assert_eq!(text(DOC, &g, (0, Some(2))), "{}");
    // With its key, where the cursor of the code finds it.
    let (start, end) = g.extent((0, Some(1))).unwrap();
    assert_eq!(
        &DOC[start as usize..end as usize],
        r#""tags": [1, {"deep": true}, []]"#
    );
    let tags = g.values[g.boxes[0].first as usize + 1].a;
    assert_eq!(text(DOC, &g, (tags, None)), r#"[1, {"deep": true}, []]"#);
    // Elements of an array have no key.
    assert_eq!(text(DOC, &g, (tags, Some(0))), "1");
    assert_eq!(text(DOC, &g, (tags, Some(1))), r#"{"deep": true}"#);
    assert_eq!(text(DOC, &g, (tags, Some(2))), "[]");
}

#[test]
fn a_place_in_the_source_leads_to_the_deepest_row_that_holds_it() {
    let g = graph(DOC);
    let at = |needle: &str| g.locate(DOC.find(needle).unwrap() as u32);
    let tags = g.values[g.boxes[0].first as usize + 1].a;
    let deep = g.boxes[tags as usize].child_first;

    assert_eq!(at("json2graph\""), Some((0, Some(0))));
    // On a key, the row of the box it opens, not the box.
    assert_eq!(at("\"tags"), Some((0, Some(1))));
    assert_eq!(at("true"), Some((deep, Some(0))));
    assert_eq!(at("\"deep"), Some((deep, Some(0))));
    // Just after a value, as a caret is after the last character: its row.
    assert_eq!(at(", {\"deep"), Some((tags, Some(0))));
    // Between the rows of a box, or on its brackets: the box.
    assert_eq!(at("[1"), Some((tags, None)));
    assert_eq!(at(" {\"deep"), Some((tags, None)));
    // An empty object or array has no box: its row.
    assert_eq!(at("{}"), Some((0, Some(2))));
    assert_eq!(at("[]]"), Some((tags, Some(2))));
    assert_eq!(g.locate(DOC.len() as u32 + 5), None);
}

#[test]
fn every_byte_leads_to_a_place_that_holds_it() {
    let src = r#"
    {
      "a": [ {"b": [1, 2, {"c": "ü ✓"}]}, null ],
      "d": { "e": { "f": -1.5e3 } },
      "g": "plain"
    }
    "#;
    let g = graph(src);
    let start = src.find('{').unwrap();
    let end = src.rfind('}').unwrap() + 1;
    for offset in 0..src.len() {
        let place = g.locate(offset as u32);
        if !(start..=end).contains(&offset) {
            assert_eq!(place, None, "offset {offset}");
            continue;
        }
        let place = place.unwrap_or_else(|| panic!("offset {offset} leads nowhere"));
        let (from, to) = g.extent(place).unwrap();
        assert!(
            (from as usize..=to as usize).contains(&offset),
            "offset {offset} led to {place:?}, at {from}..{to}"
        );
    }
}

#[test]
fn a_row_leads_back_to_itself() {
    let g = graph(DOC);
    for name in [r#""name""#, r#""n""#, r#""deep""#, r#""empty""#] {
        let place = row(DOC, &g, name);
        let (start, _) = g.extent(place).unwrap();
        assert_eq!(g.locate(start), Some(place), "{name}");
    }
}

#[test]
fn spans_are_the_same_however_the_document_is_stepped_through() {
    let whole = index(DOC.as_bytes()).unwrap().spans;
    let mut parser = Parser::new();
    while !parser.step(DOC.as_bytes(), 3).unwrap() {}
    assert_eq!(parser.index().spans, whole);
    assert!(whole.windows(2).all(|pair| pair[0].value < pair[1].value));
    // The root, `tags`, its object and its empty array, and `empty`.
    assert_eq!(whole.len(), 5);
}

#[test]
fn inside_a_collapsed_box_the_row_it_is_collapsed_into_is_shown() {
    let mut g = graph(DOC);
    let offset = DOC.find("true").unwrap() as u32;
    let tags = g.values[g.boxes[0].first as usize + 1].a;
    let deep = g.boxes[tags as usize].child_first;
    let place = g.locate(offset).unwrap();
    assert_eq!(g.shown(place), place);

    g.toggle_box(&METRICS, deep);
    assert_eq!(g.shown(place), (tags, Some(1)));
    // The outermost collapsed box decides.
    g.toggle_box(&METRICS, tags);
    assert_eq!(g.shown(place), (0, Some(1)));
}

#[test]
fn a_place_has_the_rectangle_it_is_drawn_in() {
    let g = graph(DOC);
    let b = &g.boxes[0];
    let (x, y, w, h) = g.rect(&METRICS, (0, Some(1)));
    assert_eq!((x, w, h), (b.x as f64, b.w as f64, METRICS.row_h));
    assert_eq!(y, g.row_top(b, 1, &METRICS));
    let (_, top, _, height) = g.rect(&METRICS, (0, None));
    assert_eq!(
        (top, height),
        (g.box_top(b, &METRICS), g.box_height(b, &METRICS))
    );
}

#[test]
fn a_click_inside_a_box_leads_to_a_row_and_on_its_edge_to_the_box() {
    const EDGE: f64 = 4.0;
    let g = graph(DOC);
    let b = &g.boxes[0];
    let (x, y, w, h) = g.rect(&METRICS, (0, Some(0)));
    let middle = y + h / 2.0;
    assert_eq!(
        g.place_at(&METRICS, x + w / 2.0, middle, EDGE),
        Some((0, Some(0)))
    );
    // Just inside and just outside its left edge, and above its top.
    assert_eq!(g.place_at(&METRICS, x + 2.0, middle, EDGE), Some((0, None)));
    assert_eq!(g.place_at(&METRICS, x - 3.0, middle, EDGE), Some((0, None)));
    let (_, top, _, _) = g.rect(&METRICS, (0, None));
    assert_eq!(
        g.place_at(&METRICS, x + w / 2.0, top - 2.0, EDGE),
        Some((0, None))
    );
    assert_eq!(g.place_at(&METRICS, x - 20.0, middle, EDGE), None);
    // The control of the row of `tags`, on the right edge of the box.
    let (_, y, _, h) = g.rect(&METRICS, (0, Some(1)));
    let right = (b.x + b.w) as f64;
    assert_eq!(g.place_at(&METRICS, right, y + h / 2.0, EDGE), None);
}

#[test]
fn csv_records_lead_to_their_line_and_fields_to_themselves() {
    let src = "name,age\nAda,36\n\"Grace, H\",85\r\n";
    let g = csv_graph(src);
    assert_eq!(text(src, &g, (0, Some(0))), "Ada,36");
    assert_eq!(text(src, &g, (0, Some(1))), "\"Grace, H\",85");
    let grace = g.values[g.boxes[0].first as usize + 1].a;
    // A field has no key in its line: the name is in the header.
    assert_eq!(text(src, &g, (grace, Some(0))), "Grace, H");
    assert_eq!(text(src, &g, (grace, Some(1))), "85");

    let at = |needle: &str| g.locate(src.find(needle).unwrap() as u32);
    assert_eq!(at("85"), Some((grace, Some(1))));
    assert_eq!(at("Grace"), Some((grace, Some(0))));
    // The header is no record.
    assert_eq!(at("age"), Some((0, None)));
}
