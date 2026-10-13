use json2graph_formatter::{FormatError, format};

#[test]
fn spreads_a_document_over_indented_lines() {
    let source = "{\n\"name\":\"Ada\",\"tags\":[\"a\",\"b\"],\"address\":{\n\"city\":\"Pune\"}}";
    assert_eq!(
        format(source).unwrap(),
        "{\n  \"name\": \"Ada\",\n  \"tags\": [\"a\", \"b\"],\n  \"address\": {\n    \"city\": \"Pune\"\n  }\n}\n"
    );
}

#[test]
fn is_unchanged_by_formatting_again() {
    let once = format(r#"{"a":[1,{"b":[]}],"c":"d","e":{}}"#).unwrap();
    assert_eq!(format(&once).unwrap(), once);
}

#[test]
fn leaves_values_as_written() {
    // A number too large for a double, and strings with escapes: reading the
    // document and printing it again would change all of these.
    let source = r#"[12345678901234567890, 1.0, 1e3, "\u00e9 \" } , :", "tab\there"]"#;
    assert_eq!(
        format(source).unwrap(),
        r#"[12345678901234567890, 1.0, 1e3, "\u00e9 \" } , :", "tab\there"]"#.to_owned() + "\n"
    );
}

#[test]
fn tidies_how_a_number_is_spelt_but_not_its_value() {
    assert_eq!(
        format("[-0.50, 1.500, 2E5, 0.0]").unwrap(),
        "[-0.5, 1.5, 2e5, 0.0]\n"
    );
}

#[test]
fn breaks_what_does_not_fit_on_a_line() {
    let long = format!("[{}]", [r#""0123456789""#; 12].join(","));
    let formatted = format(&long).unwrap();
    assert_eq!(formatted.lines().count(), 14);
    assert!(formatted.lines().all(|line| line.len() <= 80));
}

#[test]
fn refuses_text_that_is_not_json() {
    for source in [r#"{"a": 1,}"#, "{ oops", ""] {
        let Err(FormatError::Rejected(reason)) = format(source) else {
            panic!("{source:?} was formatted");
        };
        assert!(!reason.is_empty());
    }
}

#[test]
fn refuses_very_deep_nesting_rather_than_overflowing() {
    let deep = "[".repeat(5_000) + &"]".repeat(5_000);
    let Err(FormatError::Rejected(reason)) = format(&deep) else {
        panic!("5,000 levels were formatted");
    };
    assert!(reason.contains("nest"), "{reason}");
}
