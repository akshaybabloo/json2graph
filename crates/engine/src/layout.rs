//! Boxes and their layout.
//!
//! Every non-empty object or array is one box whose rows are its direct
//! children. Boxes are stored breadth-first, so the child boxes of a box are a
//! contiguous run in row order and parents always precede their children.
//!
//! The layout flows left to right. Each box owns a vertical band tall enough
//! for itself and for all of its descendants; child bands are stacked inside
//! the parent's band, and every box is centred in its own band.
//!
//! A row is one line of text, except that a value too long for its row can be
//! expanded onto as many wrapped lines as it needs.

use crate::parse::{Kind, NONE, Value};
use crate::wrap;

/// Pixel sizes and text limits supplied by the renderer.
#[derive(Clone, Copy, Debug)]
pub struct Metrics {
    /// Advance width of one character of the (monospace) font.
    pub char_w: f64,
    pub row_h: f64,
    pub pad_x: f64,
    pub pad_y: f64,
    /// Horizontal distance between a box and its children.
    pub gap_x: f64,
    /// Vertical distance between sibling bands.
    pub gap_y: f64,
    /// Property names and values are truncated to this many characters.
    pub max_key: u32,
    pub max_val: u32,
}

#[repr(C)]
#[derive(Clone, Debug)]
pub struct BoxRec {
    /// Top of the band that holds this box and all of its descendants.
    pub band_top: f64,
    pub band_h: f64,
    pub x: f32,
    pub w: f32,
    /// Right edge of the widest descendant.
    pub sub_right: f32,
    /// The container value this box displays, or `NONE` when the root value
    /// is not a non-empty container and is shown as a single bare row.
    pub entry: u32,
    /// Index of the value shown in the first row.
    pub first: u32,
    pub parent: u32,
    pub child_first: u32,
    pub child_count: u32,
}

/// What comes before the `[index]` in the key of every row of an array box:
/// the key of the array itself in its parent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prefix {
    /// The root array has no key.
    None,
    /// A property of an object: byte offset and length of its name.
    Name(u32, u32),
    /// An element of another array: its index there.
    Index(u32),
}

impl Prefix {
    /// Width of the prefix, in columns.
    pub fn cols(self, m: &Metrics) -> u32 {
        match self {
            Prefix::None => 0,
            Prefix::Name(_, len) => len.min(m.max_key),
            Prefix::Index(index) => digits(index),
        }
    }
}

pub struct Graph {
    pub values: Vec<Value>,
    pub boxes: Vec<BoxRec>,
    /// Expanded values as `(value index, extra lines)`, sorted by index.
    expanded: Vec<(u32, u32)>,
}

impl Graph {
    /// Builds the boxes for an index produced by [`crate::parse`].
    pub fn new(mut values: Vec<Value>) -> Graph {
        let root = values.len() as u32 - 1;
        let root_value = values[root as usize];
        let new_box = |entry, first, parent| BoxRec {
            band_top: 0.0,
            band_h: 0.0,
            x: 0.0,
            w: 0.0,
            sub_right: 0.0,
            entry,
            first,
            parent,
            child_first: 0,
            child_count: 0,
        };

        let mut boxes = Vec::new();
        if root_value.is_container() && root_value.b > 0 {
            boxes.push(new_box(root, root_value.a, NONE));
            values[root as usize].a = 0;
        } else {
            boxes.push(new_box(NONE, root, NONE));
        }

        let mut graph = Graph {
            values,
            boxes: Vec::new(),
            expanded: Vec::new(),
        };
        let mut i = 0;
        while i < boxes.len() {
            let child_first = boxes.len();
            let first = boxes[i].first as usize;
            let rows = first..first + graph_row_count(&graph.values, &boxes[i]) as usize;
            for row in rows {
                let value = &mut graph.values[row];
                if value.is_container() && value.b > 0 {
                    let id = boxes.len() as u32;
                    boxes.push(new_box(row as u32, value.a, i as u32));
                    value.a = id;
                }
            }
            boxes[i].child_first = child_first as u32;
            boxes[i].child_count = (boxes.len() - child_first) as u32;
            i += 1;
        }
        boxes.shrink_to_fit();
        graph.boxes = boxes;
        graph
    }

    pub fn row_count(&self, b: &BoxRec) -> u32 {
        graph_row_count(&self.values, b)
    }

    pub fn rows(&self, b: &BoxRec) -> &[Value] {
        &self.values[b.first as usize..][..self.row_count(b) as usize]
    }

    pub fn children(&self, b: &BoxRec) -> &[BoxRec] {
        &self.boxes[b.child_first as usize..][..b.child_count as usize]
    }

    pub fn is_array(&self, b: &BoxRec) -> bool {
        b.entry != NONE && self.values[b.entry as usize].kind() == Kind::Array
    }

    /// The expanded rows of `b`, as `(value index, extra lines)`.
    pub fn expansions(&self, b: &BoxRec) -> &[(u32, u32)] {
        if self.expanded.is_empty() {
            return &[];
        }
        let end = b.first + self.row_count(b);
        let from = self.expanded.partition_point(|e| e.0 < b.first);
        let to = self.expanded.partition_point(|e| e.0 < end);
        &self.expanded[from..to]
    }

    /// Number of text lines in `b`: one per row, plus the extra lines of its
    /// expanded rows.
    pub fn line_count(&self, b: &BoxRec) -> u64 {
        let extra: u64 = self.expansions(b).iter().map(|e| e.1 as u64).sum();
        self.row_count(b) as u64 + extra
    }

    /// Index of the line on which `row` starts.
    pub fn row_line(&self, b: &BoxRec, row: u32) -> u64 {
        let index = b.first + row;
        let before = self.expansions(b).iter().take_while(|e| e.0 < index);
        row as u64 + before.map(|e| e.1 as u64).sum::<u64>()
    }

    /// The row that `line` belongs to.
    fn line_row(&self, b: &BoxRec, line: u64) -> u32 {
        // Extra lines above the rows still being considered.
        let mut above = 0;
        for &(index, extra) in self.expansions(b) {
            let start = (index - b.first) as u64 + above;
            if line < start {
                break;
            }
            if line <= start + extra as u64 {
                return index - b.first;
            }
            above += extra as u64;
        }
        (line - above) as u32
    }

    /// World y of the top of `row`.
    pub fn row_top(&self, b: &BoxRec, row: u32, m: &Metrics) -> f64 {
        self.box_top(b, m) + m.pad_y + self.row_line(b, row) as f64 * m.row_h
    }

    /// Columns available to the value in `row`, to the right of its key.
    pub fn value_cols(&self, b: &BoxRec, row: u32, m: &Metrics) -> u32 {
        let total = ((b.w as f64 - 2.0 * m.pad_x) / m.char_w).round() as u32;
        let key = if b.entry == NONE {
            0
        } else if self.is_array(b) {
            self.array_prefix(b).cols(m) + digits(row) + 4
        } else {
            let value = &self.values[(b.first + row) as usize];
            value.key_len().min(m.max_key) + 2
        };
        total.saturating_sub(key).max(1)
    }

    /// How the array box `b` is keyed in its parent, which prefixes the
    /// `[index]` of each of its rows: `tags[0]` for a property named `tags`,
    /// `1[0]` for the second element of another array.
    pub fn array_prefix(&self, b: &BoxRec) -> Prefix {
        if b.parent == NONE {
            return Prefix::None;
        }
        let parent = &self.boxes[b.parent as usize];
        if self.is_array(parent) {
            Prefix::Index(b.entry - parent.first)
        } else {
            let entry = &self.values[b.entry as usize];
            Prefix::Name(entry.key_off, entry.key_len())
        }
    }

    pub fn box_height(&self, b: &BoxRec, m: &Metrics) -> f64 {
        self.line_count(b) as f64 * m.row_h + 2.0 * m.pad_y
    }

    /// Top edge of the box itself, which is centred in its band.
    pub fn box_top(&self, b: &BoxRec, m: &Metrics) -> f64 {
        b.band_top + (b.band_h - self.box_height(b, m)) / 2.0
    }

    /// Total size of the laid-out graph.
    pub fn size(&self) -> (f64, f64) {
        (self.boxes[0].sub_right as f64, self.boxes[0].band_h)
    }

    /// The box at a world position, if there is one there.
    pub fn box_at(&self, m: &Metrics, x: f64, y: f64) -> Option<u32> {
        let mut id = 0;
        loop {
            let b = &self.boxes[id as usize];
            if x < b.x as f64 {
                return None;
            }
            if x <= b.x as f64 + b.w as f64 {
                let top = self.box_top(b, m);
                return (top <= y && y <= top + self.box_height(b, m)).then_some(id);
            }
            // Further right: the child whose band contains `y`.
            let kids = self.children(b);
            let i = kids.partition_point(|c| c.band_top + c.band_h < y);
            if i == kids.len() || kids[i].band_top > y {
                return None;
            }
            id = b.child_first + i as u32;
        }
    }

    /// The box and row at a world position, if there is a row there.
    pub fn hit(&self, m: &Metrics, x: f64, y: f64) -> Option<(u32, u32)> {
        let id = self.box_at(m, x, y)?;
        let b = &self.boxes[id as usize];
        let line = ((y - self.box_top(b, m) - m.pad_y) / m.row_h).floor();
        if line < 0.0 || line >= self.line_count(b) as f64 {
            return None;
        }
        Some((id, self.line_row(b, line as u64)))
    }

    /// Whether `row` of box `id` holds a value that is cut short, or one that
    /// has been expanded.
    pub fn is_expandable(&self, m: &Metrics, id: u32, row: u32) -> bool {
        let index = self.boxes[id as usize].first + row;
        let value = &self.values[index as usize];
        let expanded = self.expanded.binary_search_by_key(&index, |e| e.0).is_ok();
        !value.is_container() && (value.b > m.max_val || expanded)
    }

    /// Expands the value in `row` of box `id` onto wrapped lines, or collapses
    /// it again, and repositions the boxes. Returns how far down the row
    /// moved, or `None` if the row has nothing to expand.
    pub fn toggle(&mut self, src: &[u8], m: &Metrics, id: u32, row: u32) -> Option<f64> {
        if !self.is_expandable(m, id, row) {
            return None;
        }
        let b = &self.boxes[id as usize];
        let index = b.first + row;
        let before = self.row_top(b, row, m);
        match self.expanded.binary_search_by_key(&index, |e| e.0) {
            Ok(at) => {
                self.expanded.remove(at);
            }
            Err(at) => {
                let value = self.values[index as usize];
                let cols = self.value_cols(b, row, m);
                let (lines, _) = wrap::count(src, value.a, value.b, cols);
                self.expanded.insert(at, (index, lines - 1));
            }
        }
        self.place(m);
        Some(self.row_top(&self.boxes[id as usize], row, m) - before)
    }

    pub fn layout(&mut self, m: &Metrics) {
        for i in 0..self.boxes.len() {
            self.boxes[i].w = self.box_width(&self.boxes[i], m) as f32;
        }
        self.place(m);

        // Horizontal extent of each subtree, children first.
        for i in (0..self.boxes.len()).rev() {
            let b = &self.boxes[i];
            let right = self
                .children(b)
                .iter()
                .fold(b.x + b.w, |r, kid| r.max(kid.sub_right));
            self.boxes[i].sub_right = right;
        }
    }

    /// Positions every box from the box widths and line counts.
    fn place(&mut self, m: &Metrics) {
        let n = self.boxes.len();

        // Bands, children first so a band can grow to fit its children.
        for i in (0..n).rev() {
            let b = &self.boxes[i];
            let band_h = self
                .box_height(b, m)
                .max(stacked_height(self.children(b), m.gap_y));
            self.boxes[i].band_h = band_h;
        }

        // Positions, parents first.
        self.boxes[0].band_top = 0.0;
        self.boxes[0].x = 0.0;
        for i in 0..n {
            let b = &self.boxes[i];
            let (top, band_h, right) = (b.band_top, b.band_h, b.x + b.w);
            let kids = b.child_first as usize..(b.child_first + b.child_count) as usize;
            let kids = &mut self.boxes[kids];
            let mut cursor = top + (band_h - stacked_height(kids, m.gap_y)) / 2.0;
            for kid in kids {
                kid.x = right + m.gap_x as f32;
                kid.band_top = cursor;
                cursor += kid.band_h + m.gap_y;
            }
        }
    }

    fn box_width(&self, b: &BoxRec, m: &Metrics) -> f64 {
        let rows = self.rows(b);
        let value_chars = |v: &Value| {
            if !v.is_container() {
                v.b.min(m.max_val)
            } else if v.b == 0 {
                2
            } else {
                digits(v.b) + 2
            }
        };
        let chars = if b.entry == NONE {
            value_chars(&rows[0])
        } else if self.is_array(b) {
            // `name[index]: value`
            let widest = rows.iter().map(value_chars).max().unwrap_or(0);
            let prefix = self.array_prefix(b).cols(m);
            prefix + digits(rows.len() as u32 - 1) + 4 + widest
        } else {
            let row_chars = |v: &Value| v.key_len().min(m.max_key) + 2 + value_chars(v);
            rows.iter().map(row_chars).max().unwrap_or(0)
        };
        2.0 * m.pad_x + chars as f64 * m.char_w
    }
}

fn graph_row_count(values: &[Value], b: &BoxRec) -> u32 {
    if b.entry == NONE {
        1
    } else {
        values[b.entry as usize].b
    }
}

fn stacked_height(kids: &[BoxRec], gap: f64) -> f64 {
    if kids.is_empty() {
        return 0.0;
    }
    kids.iter().map(|kid| kid.band_h).sum::<f64>() + gap * (kids.len() - 1) as f64
}

fn digits(n: u32) -> u32 {
    n.checked_ilog10().map_or(1, |d| d + 1)
}
