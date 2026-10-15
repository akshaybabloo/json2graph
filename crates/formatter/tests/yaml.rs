use json2graph_formatter::{FormatError, MAX_YAML_DEPTH, yaml};

#[test]
fn indents_by_two_spaces() {
    let source = "a:\n    b: 1\n    c:\n    -   d\n    -   e\n";
    assert_eq!(
        yaml(source).unwrap(),
        "a:\n  b: 1\n  c:\n    - d\n    - e\n"
    );
}

#[test]
fn keeps_comments_anchors_and_block_scalars() {
    let source = "# top\nbase: &base\n    x: 1 # one\nchild:\n    <<: *base\ntext: |\n    line one\n      indented\n";
    assert_eq!(
        yaml(source).unwrap(),
        "# top\nbase: &base\n  x: 1 # one\nchild:\n  <<: *base\ntext: |\n  line one\n    indented\n"
    );
}

#[test]
fn spaces_out_flow_collections() {
    assert_eq!(
        yaml("a: {x: 1,y: [1,2]}").unwrap(),
        "a: { x: 1, y: [1, 2] }\n"
    );
}

#[test]
fn keeps_every_document() {
    assert_eq!(yaml("a: 1\n---\nb: 2\n").unwrap(), "a: 1\n---\nb: 2\n");
}

#[test]
fn is_unchanged_by_formatting_again() {
    let once =
        yaml("list:\n- a\n-   {k: v}\nmap:\n      deep:\n          deeper: 'quoted'\n").unwrap();
    assert_eq!(yaml(&once).unwrap(), once);
}

#[test]
fn refuses_text_that_is_not_yaml() {
    for source in ["a: [1, 2", "a: \"open"] {
        let Err(FormatError::Rejected(reason)) = yaml(source) else {
            panic!("{source:?} was formatted");
        };
        assert!(!reason.is_empty());
    }
}

/// Documents that nest `depth` levels deep, in each way YAML nests.
fn nested(depth: usize) -> [String; 4] {
    [
        "[".repeat(depth) + &"]".repeat(depth),
        "{a: ".repeat(depth) + "1" + &"}".repeat(depth),
        (0..depth)
            .map(|level| format!("{}k:\n", " ".repeat(level)))
            .collect::<String>()
            + &" ".repeat(depth)
            + "v\n",
        "- ".repeat(depth) + "v\n",
    ]
}

#[test]
fn formats_nesting_up_to_the_limit() {
    // A debug build takes far more stack than the WebAssembly one.
    std::thread::Builder::new()
        .stack_size(64 << 20)
        .spawn(|| {
            for source in nested(MAX_YAML_DEPTH) {
                if let Err(error) = yaml(&source) {
                    panic!("{:?}: {error}", &source[..20]);
                }
            }
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn refuses_deeper_nesting_rather_than_overflowing() {
    for depth in [MAX_YAML_DEPTH + 1, 5_000] {
        for source in nested(depth) {
            let Err(FormatError::Rejected(reason)) = yaml(&source) else {
                panic!("{depth} levels were formatted");
            };
            assert!(reason.contains("nested"), "{reason}");
        }
    }
}
