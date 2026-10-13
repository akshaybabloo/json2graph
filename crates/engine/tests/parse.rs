use json2graph_engine::parse::{Kind, Parser, Value, parse};

fn text<'a>(src: &'a str, v: &Value) -> &'a str {
    &src[v.a as usize..(v.a + v.b) as usize]
}

fn key<'a>(src: &'a str, v: &Value) -> &'a str {
    &src[v.key_off as usize..(v.key_off + v.key_len()) as usize]
}

#[test]
fn children_are_contiguous() {
    let src = r#"{"a": 1, "b": {"c": [true, null], "d": "x"}, "e": -2.5e3}"#;
    let values = parse(src.as_bytes()).unwrap();
    let root = values.last().unwrap();
    assert_eq!((root.kind(), root.b), (Kind::Object, 3));

    let rows = &values[root.a as usize..(root.a + root.b) as usize];
    assert_eq!(
        rows.iter().map(|v| key(src, v)).collect::<Vec<_>>(),
        ["a", "b", "e"]
    );
    assert_eq!(text(src, &rows[0]), "1");
    assert_eq!(
        (rows[2].kind(), text(src, &rows[2])),
        (Kind::Number, "-2.5e3")
    );

    let b = &rows[1];
    assert_eq!((b.kind(), b.b), (Kind::Object, 2));
    let b_rows = &values[b.a as usize..(b.a + b.b) as usize];
    assert_eq!(
        b_rows.iter().map(|v| key(src, v)).collect::<Vec<_>>(),
        ["c", "d"]
    );
    assert_eq!(text(src, &b_rows[1]), "\"x\"");

    let c = &b_rows[0];
    let c_rows = &values[c.a as usize..(c.a + c.b) as usize];
    assert_eq!(
        c_rows.iter().map(Value::kind).collect::<Vec<_>>(),
        [Kind::True, Kind::Null]
    );
    // Array elements have no name, even right after a named sibling.
    assert!(c_rows.iter().all(|v| v.key_len() == 0));
}

#[test]
fn root_primitives_and_empty_containers() {
    assert_eq!(parse(b" 42 ").unwrap().len(), 1);
    assert_eq!(
        parse(b"\xEF\xBB\xBF\"hi\"").unwrap()[0].kind(),
        Kind::String
    );
    let empty = parse(b"[]").unwrap();
    assert_eq!(
        (empty.len(), empty[0].kind(), empty[0].b),
        (1, Kind::Array, 0)
    );
}

#[test]
fn stepping_matches_one_shot() {
    let src = br#"[{"k": [1, 2, {"deep": "value with \" quote"}]}, false, "\u00e9"]"#;
    let whole = parse(src).unwrap();
    let mut parser = Parser::new();
    let mut steps = 0;
    while !parser.step(src, 1).unwrap() {
        steps += 1;
        assert!(parser.position() <= src.len());
    }
    assert!(steps > 5);
    let stepped = parser.finish();
    assert_eq!(whole.len(), stepped.len());
    for (x, y) in whole.iter().zip(&stepped) {
        assert_eq!(
            (x.kind(), x.key_off, x.key_len(), x.a, x.b),
            (y.kind(), y.key_off, y.key_len(), y.a, y.b)
        );
    }
}

#[test]
fn deep_nesting_does_not_overflow_the_stack() {
    let depth = 200_000;
    let src = "[".repeat(depth) + &"]".repeat(depth);
    assert_eq!(parse(src.as_bytes()).unwrap().len(), depth);
}

#[test]
fn rejects_invalid_documents() {
    let cases: &[(&str, usize)] = &[
        ("", 0),
        ("[1,]", 3),
        ("{\"a\":1,}", 7),
        ("{a:1}", 1),
        ("{\"a\" 1}", 5),
        ("[1 2]", 3),
        ("\"abc", 0),
        ("\"a\\x\"", 2),
        ("\"\\u12g4\"", 1),
        ("01", 1),
        ("1.", 0),
        ("-", 0),
        ("tru", 0),
        ("[1]]", 3),
        ("{\"a\":1", 6),
        ("\"a\nb\"", 2),
    ];
    for (src, offset) in cases {
        let error = parse(src.as_bytes()).expect_err(src);
        assert_eq!(error.offset, *offset, "{src:?}: {}", error.message);
    }
}

#[test]
fn reports_line_and_column() {
    let src = b"{\n  \"a\": 1,\n  oops\n}";
    let error = parse(src).unwrap_err();
    assert_eq!(error.line_col(src), (3, 3));
}
