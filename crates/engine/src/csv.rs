//! Single-pass CSV indexer.
//!
//! It builds the same index as [`crate::parse`] would for an array with an
//! object for each record after the first, which names the columns. Nothing
//! is copied: the objects' keys point at the names in the first record, and
//! their values at the fields.
//!
//! Records follow RFC 4180: a field may be quoted, and a quoted field may
//! hold the delimiter, line breaks and quotes doubled. Records end at a line
//! break (LF, CRLF or CR), and blank lines are no records. A quoted field
//! points between its quotes, with doubled quotes left as written.

use crate::parse::{Kind, NONE, ParseError, Value};

/// Keys longer than this are cut short, as they cannot be packed into [`Value`].
const MAX_KEY_LEN: usize = (1 << 24) - 1;

/// A field: its byte range, and whether it was quoted.
#[derive(Clone, Copy)]
struct Field {
    start: usize,
    len: usize,
    quoted: bool,
}

/// Resumable CSV indexer, stepped like [`crate::parse::Parser`].
pub struct CsvParser {
    delimiter: u8,
    pos: usize,
    /// Key of each column: the byte range of its name.
    columns: Option<Vec<(u32, u32)>>,
    /// The fields of every record, record after record.
    fields: Vec<Value>,
    /// One object for each record.
    rows: Vec<Value>,
    record: Vec<Field>,
}

impl CsvParser {
    pub fn new(delimiter: u8) -> Self {
        CsvParser {
            delimiter,
            pos: 0,
            columns: None,
            fields: Vec::new(),
            rows: Vec::new(),
            record: Vec::new(),
        }
    }

    /// Number of source bytes consumed so far.
    pub fn position(&self) -> usize {
        self.pos
    }

    /// Indexes the records in roughly `budget` more bytes. Returns `true` once
    /// the whole document has been consumed.
    pub fn step(&mut self, src: &[u8], budget: usize) -> Result<bool, ParseError> {
        if src.len() >= NONE as usize {
            return Err(ParseError {
                offset: 0,
                message: "Documents of 4 GB or more are not supported",
            });
        }
        if self.pos == 0 && src.starts_with(b"\xEF\xBB\xBF") {
            self.pos = 3;
        }
        let stop = self.pos.saturating_add(budget);
        while self.pos < src.len() {
            if self.pos >= stop {
                return Ok(false);
            }
            self.record(src);
        }
        Ok(true)
    }

    /// The finished index: the fields, then the objects of the records, then
    /// the array of them, which is the root.
    pub fn finish(self) -> Vec<Value> {
        let mut values = self.fields;
        let first_row = values.len() as u32;
        let rows = self.rows.len() as u32;
        values.extend(self.rows);
        values.push(Value::new(Kind::Array, (0, 0), first_row, rows));
        values.shrink_to_fit();
        values
    }

    /// Reads the record at `pos`, and the line break after it.
    fn record(&mut self, src: &[u8]) {
        self.record.clear();
        loop {
            let field = self.field(src);
            self.record.push(field);
            match src.get(self.pos) {
                Some(&c) if c == self.delimiter => {
                    self.pos += 1;
                    // A delimiter at the very end leaves an empty last field.
                    if self.pos == src.len() {
                        self.record.push(Field {
                            start: self.pos,
                            len: 0,
                            quoted: false,
                        });
                        break;
                    }
                }
                Some(b'\r') => {
                    self.pos += if src.get(self.pos + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    };
                    break;
                }
                Some(b'\n') => {
                    self.pos += 1;
                    break;
                }
                _ => break,
            }
        }
        if let [
            Field {
                len: 0,
                quoted: false,
                ..
            },
        ] = self.record[..]
        {
            return;
        }

        let Some(columns) = &self.columns else {
            let names = self
                .record
                .iter()
                .map(|f| (f.start as u32, f.len.min(MAX_KEY_LEN) as u32));
            self.columns = Some(names.collect());
            return;
        };
        let first = self.fields.len() as u32;
        // As many values as there are columns, or fields when there are more.
        let count = self.record.len().max(columns.len());
        for column in 0..count {
            let key = columns.get(column).copied().unwrap_or((0, 0));
            let value = match self.record.get(column) {
                Some(field) => {
                    let bytes = &src[field.start..field.start + field.len];
                    let kind = if field.quoted {
                        Kind::String
                    } else {
                        kind_of(bytes)
                    };
                    Value::new(kind, key, field.start as u32, field.len as u32)
                }
                // A field the record lacks is empty.
                None => Value::new(Kind::String, key, self.pos as u32, 0),
            };
            self.fields.push(value);
        }
        self.rows
            .push(Value::new(Kind::Object, (0, 0), first, count as u32));
    }

    /// Reads the field at `pos`, leaving `pos` at the delimiter or line break
    /// after it, or at the end.
    fn field(&mut self, src: &[u8]) -> Field {
        let start = self.pos;
        if src.get(start) == Some(&b'"') {
            let mut from = start + 1;
            loop {
                let Some(quote) = src[from..].iter().position(|&b| b == b'"') else {
                    // Never closed: the field takes the rest of the document.
                    self.pos = src.len();
                    return Field {
                        start: start + 1,
                        len: src.len() - start - 1,
                        quoted: true,
                    };
                };
                let quote = from + quote;
                if src.get(quote + 1) == Some(&b'"') {
                    from = quote + 2;
                    continue;
                }
                let end = self.unquoted_end(src, quote + 1);
                self.pos = end;
                return if end == quote + 1 {
                    Field {
                        start: start + 1,
                        len: quote - start - 1,
                        quoted: true,
                    }
                } else {
                    // Text after the closing quote: the field is taken as written.
                    Field {
                        start,
                        len: end - start,
                        quoted: true,
                    }
                };
            }
        }
        let end = self.unquoted_end(src, start);
        self.pos = end;
        Field {
            start,
            len: end - start,
            quoted: false,
        }
    }

    /// Where the unquoted text from `from` ends: at a delimiter, a line break,
    /// or the end of the document.
    fn unquoted_end(&self, src: &[u8], from: usize) -> usize {
        src[from..]
            .iter()
            .position(|&b| b == self.delimiter || b == b'\n' || b == b'\r')
            .map_or(src.len(), |at| from + at)
    }
}

/// What an unquoted field is: a number, `true` or `false` when it is written
/// as one in JSON, and a string otherwise. `007` and `1,5` are strings.
fn kind_of(bytes: &[u8]) -> Kind {
    match bytes {
        b"true" => Kind::True,
        b"false" => Kind::False,
        _ if is_number(bytes) => Kind::Number,
        _ => Kind::String,
    }
}

/// Whether `bytes` is a number in JSON's grammar.
fn is_number(bytes: &[u8]) -> bool {
    let mut i = usize::from(bytes.first() == Some(&b'-'));
    let digits = |i: &mut usize| {
        let from = *i;
        while bytes.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i - from
    };
    match bytes.get(i) {
        Some(b'0') => i += 1,
        Some(b'1'..=b'9') => {
            digits(&mut i);
        }
        _ => return false,
    }
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        if digits(&mut i) == 0 {
            return false;
        }
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(bytes.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if digits(&mut i) == 0 {
            return false;
        }
    }
    i == bytes.len()
}
