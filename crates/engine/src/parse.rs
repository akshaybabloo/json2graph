//! Single-pass JSON indexer.
//!
//! The source bytes are never copied or decoded. Every JSON value becomes one
//! 16-byte [`Value`] that points back into the source, and the direct children
//! of a container are stored next to each other so row `i` of a container is
//! `values[first + i]`.

/// Sentinel for "no index".
pub const NONE: u32 = u32::MAX;

/// Keys longer than this cannot be packed into [`Value`].
const MAX_KEY_LEN: usize = (1 << 24) - 1;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Null = 0,
    False = 1,
    True = 2,
    Number = 3,
    String = 4,
    Object = 5,
    Array = 6,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Value {
    /// Byte offset of the property name, just past its opening quote.
    /// Meaningless for array elements and the root value.
    pub key_off: u32,
    /// `kind | key_len << 8`.
    meta: u32,
    /// Primitives: byte offset of the token.
    /// Containers: index of the first child, replaced by the box id once
    /// boxes are built.
    pub a: u32,
    /// Primitives: byte length of the token. Containers: number of children.
    pub b: u32,
}

impl Value {
    fn new(kind: Kind, key: (u32, u32), a: u32, b: u32) -> Self {
        Value {
            key_off: key.0,
            meta: kind as u32 | key.1 << 8,
            a,
            b,
        }
    }

    pub fn kind(&self) -> Kind {
        match self.meta as u8 {
            0 => Kind::Null,
            1 => Kind::False,
            2 => Kind::True,
            3 => Kind::Number,
            4 => Kind::String,
            5 => Kind::Object,
            _ => Kind::Array,
        }
    }

    pub fn key_len(&self) -> u32 {
        self.meta >> 8
    }

    pub fn is_container(&self) -> bool {
        self.meta as u8 >= Kind::Object as u8
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct ParseError {
    pub offset: usize,
    pub message: &'static str,
}

impl ParseError {
    /// 1-based line and column (in bytes) of the error.
    pub fn line_col(&self, src: &[u8]) -> (usize, usize) {
        let before = &src[..self.offset.min(src.len())];
        let line = before.iter().filter(|&&b| b == b'\n').count() + 1;
        let line_start = before
            .iter()
            .rposition(|&b| b == b'\n')
            .map_or(0, |i| i + 1);
        (line, before.len() - line_start + 1)
    }
}

fn err<T>(offset: usize, message: &'static str) -> Result<T, ParseError> {
    Err(ParseError { offset, message })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Value,
    ArrayStart,
    ObjectStart,
    Key,
    AfterValue,
    End,
}

struct Frame {
    kind: Kind,
    /// Where this container's children begin in `scratch`.
    start: usize,
    key: (u32, u32),
}

/// Resumable, non-recursive parser: nesting depth is limited by memory only,
/// and `step` can be called with a byte budget so the caller can report
/// progress between calls.
pub struct Parser {
    pos: usize,
    state: State,
    stack: Vec<Frame>,
    /// Finished values whose parent container is still open.
    scratch: Vec<Value>,
    values: Vec<Value>,
    key: (u32, u32),
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}

impl Parser {
    pub fn new() -> Self {
        Parser {
            pos: 0,
            state: State::Value,
            stack: Vec::new(),
            scratch: Vec::new(),
            values: Vec::new(),
            key: (0, 0),
        }
    }

    /// Number of source bytes consumed so far.
    pub fn position(&self) -> usize {
        self.pos
    }

    /// Parses roughly `budget` more bytes. Returns `true` once the whole
    /// document has been consumed.
    pub fn step(&mut self, src: &[u8], budget: usize) -> Result<bool, ParseError> {
        if src.len() >= NONE as usize {
            return err(0, "Documents of 4 GB or more are not supported");
        }
        if self.pos == 0 && src.starts_with(b"\xEF\xBB\xBF") {
            self.pos = 3;
        }
        let stop = self.pos.saturating_add(budget);
        loop {
            self.skip_whitespace(src);
            if self.state == State::End {
                return if self.pos < src.len() {
                    err(self.pos, "Unexpected content after the end of the document")
                } else {
                    Ok(true)
                };
            }
            let Some(&c) = src.get(self.pos) else {
                return err(self.pos, "Unexpected end of input");
            };
            if self.pos >= stop {
                return Ok(false);
            }
            match self.state {
                State::ObjectStart if c == b'}' => self.close(),
                State::ObjectStart | State::Key => self.key(src)?,
                State::ArrayStart if c == b']' => self.close(),
                State::ArrayStart | State::Value => self.value(src, c)?,
                State::AfterValue => {
                    let kind = self.stack.last().map(|f| f.kind);
                    match (c, kind) {
                        (b',', Some(Kind::Object)) => {
                            self.pos += 1;
                            self.state = State::Key;
                        }
                        (b',', Some(Kind::Array)) => {
                            self.pos += 1;
                            self.state = State::Value;
                        }
                        (b'}', Some(Kind::Object)) | (b']', Some(Kind::Array)) => self.close(),
                        (_, Some(Kind::Object)) => return err(self.pos, "Expected ',' or '}'"),
                        _ => return err(self.pos, "Expected ',' or ']'"),
                    }
                }
                State::End => unreachable!(),
            }
        }
    }

    /// The finished index. The root value is the last element.
    pub fn finish(mut self) -> Vec<Value> {
        debug_assert!(self.state == State::End && self.scratch.len() == 1);
        self.values.append(&mut self.scratch);
        self.values.shrink_to_fit();
        self.values
    }

    fn skip_whitespace(&mut self, src: &[u8]) {
        while let Some(b' ' | b'\n' | b'\r' | b'\t') = src.get(self.pos) {
            self.pos += 1;
        }
    }

    fn key(&mut self, src: &[u8]) -> Result<(), ParseError> {
        if src[self.pos] != b'"' {
            return err(self.pos, "Expected a property name in double quotes");
        }
        let close = scan_string(src, self.pos)?;
        let len = close - self.pos - 1;
        if len > MAX_KEY_LEN {
            return err(self.pos, "Property name is too long");
        }
        self.key = ((self.pos + 1) as u32, len as u32);
        self.pos = close + 1;
        self.skip_whitespace(src);
        if src.get(self.pos) != Some(&b':') {
            return err(self.pos, "Expected ':' after the property name");
        }
        self.pos += 1;
        self.state = State::Value;
        Ok(())
    }

    fn value(&mut self, src: &[u8], c: u8) -> Result<(), ParseError> {
        let start = self.pos;
        // Array elements and the root have no name, so the key is consumed here.
        let key = std::mem::take(&mut self.key);
        let (kind, end) = match c {
            b'{' | b'[' => {
                let (kind, state) = if c == b'{' {
                    (Kind::Object, State::ObjectStart)
                } else {
                    (Kind::Array, State::ArrayStart)
                };
                self.stack.push(Frame {
                    kind,
                    start: self.scratch.len(),
                    key,
                });
                self.pos += 1;
                self.state = state;
                return Ok(());
            }
            b'"' => (Kind::String, scan_string(src, start)? + 1),
            b'-' | b'0'..=b'9' => (Kind::Number, scan_number(src, start)?),
            b't' => (Kind::True, scan_literal(src, start, b"true")?),
            b'f' => (Kind::False, scan_literal(src, start, b"false")?),
            b'n' => (Kind::Null, scan_literal(src, start, b"null")?),
            _ => return err(start, "Unexpected character"),
        };
        self.scratch
            .push(Value::new(kind, key, start as u32, (end - start) as u32));
        self.pos = end;
        self.value_done();
        Ok(())
    }

    /// Closes the innermost container: its children move from `scratch` to a
    /// contiguous run in `values`, and the container itself becomes a pending
    /// child of its own parent.
    fn close(&mut self) {
        self.pos += 1;
        let frame = self.stack.pop().expect("close without an open container");
        let first = self.values.len() as u32;
        let count = (self.scratch.len() - frame.start) as u32;
        self.values.extend_from_slice(&self.scratch[frame.start..]);
        self.scratch.truncate(frame.start);
        self.scratch
            .push(Value::new(frame.kind, frame.key, first, count));
        self.value_done();
    }

    fn value_done(&mut self) {
        self.state = if self.stack.is_empty() {
            State::End
        } else {
            State::AfterValue
        };
    }
}

/// `start` is the opening quote; returns the index of the closing quote.
fn scan_string(src: &[u8], start: usize) -> Result<usize, ParseError> {
    let mut i = start + 1;
    loop {
        match src.get(i) {
            None => return err(start, "Unterminated string"),
            Some(b'"') => return Ok(i),
            Some(b'\\') => match src.get(i + 1) {
                Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => i += 2,
                Some(b'u') => {
                    let hex = src.get(i + 2..i + 6);
                    if !hex.is_some_and(|h| h.iter().all(u8::is_ascii_hexdigit)) {
                        return err(i, "Invalid \\u escape");
                    }
                    i += 6;
                }
                _ => return err(i, "Invalid escape sequence"),
            },
            Some(0..=0x1F) => return err(i, "Unescaped control character in string"),
            Some(_) => i += 1,
        }
    }
}

/// Returns the index just past the number that begins at `start`.
fn scan_number(src: &[u8], start: usize) -> Result<usize, ParseError> {
    let digits = |mut i: usize| {
        let from = i;
        while src.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        if i == from {
            err(start, "Invalid number")
        } else {
            Ok(i)
        }
    };
    let mut i = start;
    if src[i] == b'-' {
        i += 1;
    }
    i = if src.get(i) == Some(&b'0') {
        i + 1
    } else {
        digits(i)?
    };
    if src.get(i) == Some(&b'.') {
        i = digits(i + 1)?;
    }
    if let Some(b'e' | b'E') = src.get(i) {
        i += 1;
        if let Some(b'+' | b'-') = src.get(i) {
            i += 1;
        }
        i = digits(i)?;
    }
    Ok(i)
}

fn scan_literal(src: &[u8], start: usize, literal: &[u8]) -> Result<usize, ParseError> {
    if src[start..].starts_with(literal) {
        Ok(start + literal.len())
    } else {
        err(start, "Unexpected character")
    }
}

/// Parses a whole document in one go.
pub fn parse(src: &[u8]) -> Result<Vec<Value>, ParseError> {
    let mut parser = Parser::new();
    while !parser.step(src, usize::MAX)? {}
    Ok(parser.finish())
}
