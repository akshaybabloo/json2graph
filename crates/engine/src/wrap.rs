//! Line wrapping for an expanded value.
//!
//! A value is wrapped on the source bytes, without decoding it: each line is a
//! byte range that the renderer decodes like any other row. Lines break after
//! a space where they can, and never split a UTF-8 sequence or a JSON escape.

/// An expanded value shows at most this many lines.
pub const MAX_LINES: u32 = 500;

/// Iterator over the lines of the token at `src[offset..offset + len]`, as
/// `(offset, length)` byte ranges of at most `cols` columns each.
pub struct Lines<'a> {
    src: &'a [u8],
    pos: usize,
    end: usize,
    cols: u32,
}

pub fn lines(src: &[u8], offset: u32, len: u32, cols: u32) -> Lines<'_> {
    let pos = offset as usize;
    Lines {
        src,
        pos,
        end: pos + len as usize,
        cols: cols.max(1),
    }
}

impl Iterator for Lines<'_> {
    type Item = (u32, u32);

    fn next(&mut self) -> Option<(u32, u32)> {
        if self.pos >= self.end {
            return None;
        }
        let start = self.pos;
        let mut used = 0;
        // Just past the last space on this line.
        let mut after_space = None;
        while self.pos < self.end {
            let (bytes, width) = unit(&self.src[self.pos..self.end]);
            if used > 0 && used + width > self.cols {
                // Break after a space when there is one, so words stay whole.
                if let Some(at) = after_space {
                    self.pos = at;
                }
                break;
            }
            self.pos += bytes;
            used += width;
            if self.src[self.pos - 1] == b' ' {
                after_space = Some(self.pos);
            }
        }
        Some((start as u32, (self.pos - start) as u32))
    }
}

/// Number of lines the value is shown on, and whether [`MAX_LINES`] cut it short.
pub fn count(src: &[u8], offset: u32, len: u32, cols: u32) -> (u32, bool) {
    let total = lines(src, offset, len, cols)
        .take(MAX_LINES as usize + 1)
        .count() as u32;
    (total.min(MAX_LINES), total > MAX_LINES)
}

/// Byte length and display width, in columns, of the unit at the start of `s`.
fn unit(s: &[u8]) -> (usize, u32) {
    let (bytes, width) = match s[0] {
        // `\uXXXX` is shown decoded, as one character. A surrogate pair is
        // one character written as two escapes.
        b'\\' if s.get(1) == Some(&b'u') => {
            let high = matches!(s.get(2), Some(b'd' | b'D'))
                && matches!(s.get(3), Some(b'8' | b'9' | b'a' | b'b' | b'A' | b'B'));
            if high && s.get(6..8) == Some(b"\\u") {
                (12, 2)
            } else {
                (6, 1)
            }
        }
        // Other escapes are shown as written.
        b'\\' => (2, 2),
        0xC0..=0xDF => (2, 1),
        // Mostly CJK and emoji, which are two columns wide in a monospace font.
        0xE0..=0xEF => (3, 2),
        0xF0..=0xFF => (4, 2),
        _ => (1, 1),
    };
    (bytes.min(s.len()), width)
}
