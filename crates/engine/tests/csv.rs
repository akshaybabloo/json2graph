mod common;

use json2graph_engine::csv::CsvParser;
use json2graph_engine::layout::Graph;
use json2graph_engine::parse::{Kind, Value};

fn index(src: &str, delimiter: u8) -> Vec<Value> {
    let mut parser = CsvParser::new(delimiter);
    assert!(parser.step(src.as_bytes(), usize::MAX).unwrap());
    parser.finish()
}

/// What a value says: its key and its text, with a quoted field's doubled
/// quotes undone, as a reader of the CSV would take it.
fn field(src: &str, value: &Value) -> (String, String) {
    let text = |start: u32, len: u32| src[start as usize..(start + len) as usize].to_owned();
    let unquote = |start: u32, len: u32| {
        let quoted = start > 0 && src.as_bytes()[start as usize - 1] == b'"';
        let text = text(start, len);
        if quoted {
            text.replace("\"\"", "\"")
        } else {
            text
        }
    };
    (
        unquote(value.key_off, value.key_len()),
        unquote(value.a, value.b),
    )
}

/// The rows of an index, each as its keys and texts.
fn rows(src: &str, values: &[Value]) -> Vec<Vec<(String, String)>> {
    let root = values.last().unwrap();
    assert_eq!(root.kind(), Kind::Array);
    (root.a..root.a + root.b)
        .map(|row| {
            let object = &values[row as usize];
            assert_eq!(object.kind(), Kind::Object);
            (object.a..object.a + object.b)
                .map(|at| field(src, &values[at as usize]))
                .collect()
        })
        .collect()
}

fn pairs(row: &[(&str, &str)]) -> Vec<(String, String)> {
    row.iter()
        .map(|&(k, v)| (k.to_owned(), v.to_owned()))
        .collect()
}

#[test]
fn each_record_after_the_first_is_an_object_keyed_by_the_first() {
    let src = "name,age\nAda,36\nGrace,85\n";
    let values = index(src, b',');
    assert_eq!(
        rows(src, &values),
        [
            pairs(&[("name", "Ada"), ("age", "36")]),
            pairs(&[("name", "Grace"), ("age", "85")])
        ]
    );
    // Two fields for each of two rows, the rows, and the array of them.
    assert_eq!(values.len(), 4 + 2 + 1);
}

#[test]
fn fields_written_as_json_numbers_or_booleans_are_those() {
    let src = "a,b,c,d,e,f,g\n12,-0.5e3,true,false,007,\"1\",1,5\n";
    let kinds: Vec<Kind> = index(src, b',')[..7].iter().map(Value::kind).collect();
    assert_eq!(
        kinds,
        [
            Kind::Number,
            Kind::Number,
            Kind::True,
            Kind::False,
            Kind::String,
            Kind::String,
            Kind::Number
        ]
    );
}

#[test]
fn quoted_fields_hold_delimiters_line_breaks_and_doubled_quotes() {
    let src = "a,b,c\r\n\"x,y\",\"say \"\"hi\"\"\",\"two\nlines\"\r\n";
    assert_eq!(
        rows(src, &index(src, b',')),
        [pairs(&[
            ("a", "x,y"),
            ("b", "say \"hi\""),
            ("c", "two\nlines")
        ])]
    );
}

#[test]
fn blank_lines_are_skipped_and_any_line_break_ends_a_record() {
    let src = "\u{feff}a;b\r\r\n1;2\n\n3;4\r5;6";
    let rows = rows(src, &index(src, b';'));
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[2], pairs(&[("a", "5"), ("b", "6")]));
}

#[test]
fn missing_fields_are_empty_and_extra_ones_have_no_name() {
    let src = "a,b\n1\n2,3,4\n5,\n";
    assert_eq!(
        rows(src, &index(src, b',')),
        [
            pairs(&[("a", "1"), ("b", "")]),
            pairs(&[("a", "2"), ("b", "3"), ("", "4")]),
            pairs(&[("a", "5"), ("b", "")])
        ]
    );
}

#[test]
fn a_header_alone_or_nothing_is_an_empty_array() {
    for src in ["a,b\n", "", "\n\n"] {
        let values = index(src, b',');
        assert_eq!(values.len(), 1, "{src:?}");
        assert_eq!((values[0].kind(), values[0].b), (Kind::Array, 0));
    }
}

#[test]
fn stepping_in_small_budgets_gives_the_same_index() {
    let src: String = std::iter::once("id,text\n".to_owned())
        .chain((0..500).map(|i| format!("{i},\"line {i}\nnext\"\r\n")))
        .collect();
    let mut parser = CsvParser::new(b',');
    let mut steps = 0;
    while !parser.step(src.as_bytes(), 64).unwrap() {
        steps += 1;
    }
    assert!(steps > 10);
    assert_eq!(rows(&src, &parser.finish()), rows(&src, &index(&src, b',')));
}

#[test]
fn the_records_are_those_that_the_csv_crate_reads() {
    let documents = [
        "a,b,c\n1,2,3\n4,5,6\n",
        "a,b\r\n\"q,1\",\"x\"\"y\"\r\n\"\",\n",
        "name,notes\nAda,\"multi\r\nline\"\nGrace,\"\"\"quoted\"\"\"\n",
        "x,y\n1,2\n\n\n3,4",
        "h1,h2,h3\n,,\n\"\",\"\",\"\"\n",
        "a\tb\nx\ty\n",
    ];
    for src in documents {
        let delimiter = if src.contains('\t') { b'\t' } else { b',' };
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(delimiter)
            .flexible(true)
            .from_reader(src.as_bytes());
        let header: Vec<String> = reader
            .headers()
            .unwrap()
            .iter()
            .map(str::to_owned)
            .collect();
        let expected: Vec<Vec<(String, String)>> = reader
            .records()
            .map(|record| {
                let record = record.unwrap();
                header
                    .iter()
                    .cloned()
                    .zip(record.iter().map(str::to_owned))
                    .collect()
            })
            .collect();
        assert_eq!(rows(src, &index(src, delimiter)), expected, "{src:?}");
    }
}

#[test]
fn the_index_lays_out_as_a_graph() {
    let src = "a,b\n1,2\n3,4\n";
    let mut graph = Graph::new(index(src, b','));
    graph.layout(&common::METRICS);
    // The array, and an object for each row.
    assert_eq!(graph.boxes.len(), 3);
}
