use json2graph_engine::wrap::{MAX_LINES, count, lines};

fn wrap(text: &str, cols: u32) -> Vec<&str> {
    lines(text.as_bytes(), 0, text.len() as u32, cols)
        .map(|(offset, len)| &text[offset as usize..(offset + len) as usize])
        .collect()
}

#[test]
fn breaks_at_the_column_limit() {
    assert_eq!(
        wrap("\"abcdefghijklmnopqrstuvw\"", 10),
        ["\"abcdefghi", "jklmnopqrs", "tuvw\""]
    );
    assert_eq!(wrap("12345", 5), ["12345"]);
    assert_eq!(wrap("123456", 5), ["12345", "6"]);
}

#[test]
fn keeps_words_whole_where_it_can() {
    assert_eq!(
        wrap("\"the quick brown fox jumps\"", 12),
        ["\"the quick ", "brown fox ", "jumps\""]
    );
    // A word longer than a line is still split.
    assert_eq!(wrap("ab abcdefghij", 5), ["ab ", "abcde", "fghij"]);
    // A space that ends the line exactly is not a reason to break early.
    assert_eq!(wrap("abcd efgh", 5), ["abcd ", "efgh"]);
}

#[test]
fn covers_a_range_inside_a_larger_source() {
    let src = b"{\"key\": \"0123456789\"}";
    let ranges: Vec<_> = lines(src, 8, 12, 5).collect();
    assert_eq!(ranges, [(8, 5), (13, 5), (18, 2)]);
}

#[test]
fn never_splits_a_character() {
    // Two-byte characters are one column each.
    assert_eq!(wrap("ééééé", 2), ["éé", "éé", "é"]);
    // Three- and four-byte characters count as two columns.
    assert_eq!(wrap("世界世界", 4), ["世界", "世界"]);
    assert_eq!(wrap("世界世界", 3), ["世", "界", "世", "界"]);
    assert_eq!(wrap("a😀b", 3), ["a😀", "b"]);
    // A character wider than the line still gets a line of its own.
    assert_eq!(wrap("世界", 1), ["世", "界"]);
}

#[test]
fn never_splits_an_escape() {
    // `\n` is shown as written: two columns.
    assert_eq!(wrap(r"ab\ncd", 3), ["ab", r"\nc", "d"]);
    // `é` is shown decoded: one column.
    assert_eq!(wrap(r"abécd", 3), [r"abé", "cd"]);
    // A surrogate pair is one character, two columns wide.
    assert_eq!(wrap(r"a😀b", 3), [r"a😀", "b"]);
    assert_eq!(wrap(r"ab😀", 3), ["ab", r"😀"]);
    // An escaped backslash does not start a `\u` escape.
    assert_eq!(wrap(r"\\u00e9", 4), [r"\\u0", "0e9"]);
}

#[test]
fn counts_lines_up_to_the_limit() {
    let text = "x".repeat(95);
    assert_eq!(count(text.as_bytes(), 0, 95, 10), (10, false));
    assert_eq!(count(text.as_bytes(), 0, 95, 95), (1, false));

    let long = "x".repeat(MAX_LINES as usize * 10 + 1);
    assert_eq!(
        count(long.as_bytes(), 0, long.len() as u32, 10),
        (MAX_LINES, true)
    );
    let exact = &long[1..];
    assert_eq!(
        count(exact.as_bytes(), 0, exact.len() as u32, 10),
        (MAX_LINES, false)
    );
}
