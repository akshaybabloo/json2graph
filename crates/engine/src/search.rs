//! Finding text in the graph: the rows whose key or value holds it, as the
//! graph shows them, in the order they are read, which is that of the source.
//!
//! A key is the name of a property; the `[index]` of an element of an array
//! is not searched. A value is its token as written, quotes and all, except
//! that `\uXXXX` escapes are read as the characters they stand for, as the
//! graph shows them. An object or array is found only by its key.

use std::borrow::Cow;

use crate::layout::{Graph, Place};
use crate::parse::NONE;

/// What is looked for, and whether its case must match.
pub struct Needle {
    /// The text, in lower case unless the case must match.
    text: String,
    match_case: bool,
}

impl Needle {
    pub fn new(text: &str, match_case: bool) -> Needle {
        let text = if match_case {
            text.to_owned()
        } else {
            text.to_lowercase()
        };
        Needle { text, match_case }
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    /// Whether `raw`, a key or a value as written in the source, holds the
    /// needle as the graph shows it.
    pub fn found_in(&self, raw: &[u8]) -> bool {
        let shown = shown(raw);
        let (hay, needle) = (&*shown, self.text.as_bytes());
        if needle.is_empty() || hay.len() < needle.len() {
            return false;
        }
        if self.match_case {
            return hay.windows(needle.len()).any(|w| w == needle);
        }
        if hay.is_ascii() {
            return hay
                .windows(needle.len())
                .any(|w| w.eq_ignore_ascii_case(needle));
        }
        String::from_utf8_lossy(hay)
            .to_lowercase()
            .contains(&self.text)
    }
}

/// The rows of `g` whose key or value holds `needle`, depth first, as the
/// graph is read: each row before the rows of the box it leads to.
pub fn search(g: &Graph, src: &[u8], needle: &Needle) -> Vec<Place> {
    let mut found = Vec::new();
    if needle.is_empty() {
        return found;
    }
    // The boxes being read, and the row to read next in each.
    let mut stack = vec![(0u32, 0u32)];
    while let Some(&(id, row)) = stack.last() {
        let b = &g.boxes[id as usize];
        if row == g.row_count(b) {
            stack.pop();
            continue;
        }
        stack.last_mut().unwrap().1 += 1;
        let value = &g.values[(b.first + row) as usize];
        let keyed = b.entry != NONE && !g.is_array(b);
        let key = || {
            let start = value.key_off as usize;
            needle.found_in(&src[start..start + value.key_len() as usize])
        };
        let text = || {
            let start = value.a as usize;
            needle.found_in(&src[start..start + value.b as usize])
        };
        if (keyed && key()) || (!value.is_container() && text()) {
            found.push((id, Some(row)));
        }
        // A container that is not empty has a box, whose id is in `a`.
        if value.is_container() && value.b > 0 {
            stack.push((value.a, 0));
        }
    }
    found
}

/// The text of `raw` as the graph shows it: `\uXXXX` escapes are read as the
/// characters they stand for, other escapes are left as written.
fn shown(raw: &[u8]) -> Cow<'_, [u8]> {
    if !raw.windows(2).any(|w| w == b"\\u") {
        return Cow::Borrowed(raw);
    }
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] != b'\\' {
            out.push(raw[i]);
            i += 1;
            continue;
        }
        if let Some((c, len)) = escape(&raw[i..]) {
            out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            i += len;
        } else {
            // Both characters, so that the `u` of `\\u` starts no escape.
            let end = (i + 2).min(raw.len());
            out.extend_from_slice(&raw[i..end]);
            i = end;
        }
    }
    Cow::Owned(out)
}

/// The character of the `\uXXXX` escape at the start of `s`, or of the two
/// that make a surrogate pair, and how many bytes they take. None for a
/// control character, which is shown as written.
fn escape(s: &[u8]) -> Option<(char, usize)> {
    let unit = |at: usize| {
        let escape = s.get(at..at + 6)?;
        let hex = escape.strip_prefix(b"\\u")?;
        if !hex.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        u32::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()
    };
    let first = unit(0)?;
    if (0xd800..0xdc00).contains(&first) {
        let second = unit(6).filter(|second| (0xdc00..0xe000).contains(second))?;
        let c = char::from_u32(0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00))?;
        return Some((c, 12));
    }
    if first < 0x20 {
        return None;
    }
    char::from_u32(first).map(|c| (c, 6))
}
