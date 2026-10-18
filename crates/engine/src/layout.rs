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
//!
//! A box can be collapsed into its row in the parent. It and its descendants
//! are then not drawn and take no room, and the boxes around them close up.
//!
//! With the spans of the containers, rows lead back to where they are in the
//! source, and a place in the source leads to the row that shows it.

use crate::parse::{Index, Kind, NONE, Span, Value};
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
    /// Width of the control that collapses the box of a value. It sits on the
    /// right edge of the box, in the row of the value, half in and half out.
    pub toggle_w: f64,
    /// Property names and values are truncated to this many characters.
    pub max_key: u32,
    pub max_val: u32,
}

#[repr(C)]
#[derive(Clone, Debug)]
pub struct BoxRec {
    /// Top of the band that holds this box and all of its descendants.
    pub band_top: f64,
    /// Height of that band: none for a collapsed box.
    pub band_h: f64,
    pub x: f32,
    pub w: f32,
    /// Right edge of the widest descendant that is shown.
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
    /// One bit per box, set for the collapsed ones. Empty until a box is
    /// collapsed.
    collapsed: Vec<u64>,
    /// Where the containers are in the source, sorted by value. Empty when
    /// the graph was built without them.
    spans: Vec<Span>,
    /// One bit per value, set for those in the rows a search found. Empty
    /// while nothing is found.
    found: Vec<u64>,
}

/// A box, and one of its rows or the box as a whole.
pub type Place = (u32, Option<u32>);

impl Graph {
    /// Builds the boxes for the values of an index produced by
    /// [`crate::parse`], which then lead to no place in the source.
    pub fn new(values: Vec<Value>) -> Graph {
        Graph::from_index(Index {
            values,
            spans: Vec::new(),
        })
    }

    /// Builds the boxes for an index produced by [`crate::parse`].
    pub fn from_index(Index { mut values, spans }: Index) -> Graph {
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
            collapsed: Vec::new(),
            spans,
            found: Vec::new(),
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
            // A collapsed box has an empty band, where the next one starts.
            let i = self.shown_from(b, i);
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

    /// Whether box `id` is collapsed into its row in the parent.
    pub fn is_collapsed(&self, id: u32) -> bool {
        let word = self.collapsed.get(id as usize / 64);
        word.is_some_and(|word| word >> (id % 64) & 1 == 1)
    }

    /// The first child of `b` at or after index `i` that is shown, or the
    /// number of children when there is none.
    ///
    /// Collapsed children are stepped over a run at a time, however long the
    /// run: none of them moves the next band down, so they all share their
    /// `band_top` with the shown child that follows them.
    pub fn shown_from(&self, b: &BoxRec, mut i: usize) -> usize {
        let kids = self.children(b);
        let collapsed = |i: usize| self.is_collapsed(b.child_first + i as u32);
        while i < kids.len() && collapsed(i) {
            let top = kids[i].band_top;
            let past = i + kids[i..].partition_point(|c| c.band_top <= top);
            // The last child at that height is the shown one, unless the run
            // goes on to the last child.
            i = if collapsed(past - 1) { past } else { past - 1 };
        }
        i
    }

    /// The box that a click at a world position would collapse or show again:
    /// the box of the value in the row there, when the position is on the
    /// control of that row.
    pub fn collapsible_at(&self, m: &Metrics, x: f64, y: f64) -> Option<u32> {
        // The control reaches half its width outside the box, so look for the
        // row from that far to the left.
        let half = m.toggle_w / 2.0;
        let (id, row) = self.hit(m, x - half, y)?;
        let b = &self.boxes[id as usize];
        let value = &self.values[(b.first + row) as usize];
        let right = b.x as f64 + b.w as f64;
        (value.is_container() && value.b > 0 && x >= right - half).then_some(value.a)
    }

    /// Collapses box `id` into its row in the parent, or shows it again, and
    /// repositions the boxes. Returns how far down that row moved, or `None`
    /// for the root, which has no row to collapse into.
    pub fn toggle_box(&mut self, m: &Metrics, id: u32) -> Option<f64> {
        let b = &self.boxes[id as usize];
        if b.parent == NONE {
            return None;
        }
        let parent = b.parent as usize;
        let row = b.entry - self.boxes[parent].first;
        let before = self.row_top(&self.boxes[parent], row, m);
        if self.collapsed.is_empty() {
            self.collapsed = vec![0; self.boxes.len().div_ceil(64)];
        }
        self.collapsed[id as usize / 64] ^= 1 << (id % 64);
        self.place(m);
        Some(self.row_top(&self.boxes[parent], row, m) - before)
    }

    /// Collapses every box into its row, which leaves the root alone on
    /// screen, or shows every box again, and repositions the boxes. A box
    /// shown again after all were collapsed still has its own boxes collapsed.
    pub fn set_all_collapsed(&mut self, m: &Metrics, collapsed: bool) {
        self.collapsed.clear();
        if collapsed {
            self.collapsed
                .resize(self.boxes.len().div_ceil(64), u64::MAX);
            // The root has no row to collapse into.
            self.collapsed[0] &= !1;
        }
        self.place(m);
    }

    /// Shows box `id` and every box it is inside that is collapsed, and
    /// repositions the boxes. Returns whether any was collapsed.
    pub fn expand_to(&mut self, m: &Metrics, mut id: u32) -> bool {
        let mut changed = false;
        while id != NONE {
            if self.is_collapsed(id) {
                self.collapsed[id as usize / 64] ^= 1 << (id % 64);
                changed = true;
            }
            id = self.boxes[id as usize].parent;
        }
        if changed {
            self.place(m);
        }
        changed
    }

    /// Marks `places` as the rows a search found, in place of those before.
    pub fn set_found(&mut self, places: &[Place]) {
        self.found.clear();
        if places.is_empty() {
            return;
        }
        self.found.resize(self.values.len().div_ceil(64), 0);
        for &(id, row) in places {
            let Some(row) = row else { continue };
            let index = self.boxes[id as usize].first + row;
            self.found[index as usize / 64] |= 1 << (index % 64);
        }
    }

    /// Whether value `index` is in a row a search found.
    pub fn is_found(&self, index: u32) -> bool {
        let word = self.found.get(index as usize / 64);
        word.is_some_and(|word| word >> (index % 64) & 1 == 1)
    }

    /// Where value `index` is in the source: the token of a primitive, the
    /// brackets and all between them of a container.
    fn value_range(&self, index: u32) -> Option<(u32, u32)> {
        let value = &self.values[index as usize];
        if !value.is_container() {
            return Some((value.a, value.a + value.b));
        }
        let at = self.spans.binary_search_by_key(&index, |s| s.value).ok()?;
        let span = &self.spans[at];
        Some((span.start, span.end))
    }

    /// Where the value in `row` of `b` is in the source: a datum, or the
    /// brackets and all between them of an object or array.
    pub fn row_range(&self, b: &BoxRec, row: u32) -> Option<(u32, u32)> {
        self.value_range(b.first + row)
    }

    /// Where all of `row` of `b` is in the source: its value, from its key
    /// when the key is written there, as it is in an object but not in a CSV
    /// record.
    pub fn row_extent(&self, b: &BoxRec, row: u32) -> Option<(u32, u32)> {
        let index = b.first + row;
        let (start, end) = self.value_range(index)?;
        if b.entry == NONE || self.is_array(b) {
            return Some((start, end));
        }
        let (open, _) = self.value_range(b.entry)?;
        // The opening quote of the key.
        let key = self.values[index as usize].key_off.checked_sub(1);
        Some(match key {
            Some(key) if open < key && key < start => (key, end),
            _ => (start, end),
        })
    }

    /// Where a place is in the source: the value of a row, or the whole of a
    /// box.
    pub fn source_range(&self, (id, row): Place) -> Option<(u32, u32)> {
        let b = &self.boxes[id as usize];
        match row {
            Some(row) => self.row_range(b, row),
            None if b.entry == NONE => self.row_range(b, 0),
            None => self.value_range(b.entry),
        }
    }

    /// Where a place is in the source, with the key of a row.
    pub fn extent(&self, (id, row): Place) -> Option<(u32, u32)> {
        match row {
            Some(row) => self.row_extent(&self.boxes[id as usize], row),
            None => self.source_range((id, None)),
        }
    }

    /// The place that shows byte `offset` of the source, however deep: the
    /// row whose key or value it is in, or the box it is in between rows.
    /// None outside the document, or when the graph has no spans.
    pub fn locate(&self, offset: u32) -> Option<Place> {
        let within = |(start, end): (u32, u32)| start <= offset && offset <= end;
        let root = &self.boxes[0];
        if root.entry == NONE {
            return within(self.row_range(root, 0)?).then_some((0, Some(0)));
        }
        if !within(self.value_range(root.entry)?) {
            return None;
        }
        let mut id = 0;
        loop {
            let b = &self.boxes[id as usize];
            // Rows are in the order of the source: the last that starts at or
            // before the offset is the only one that can hold it.
            let (mut low, mut high) = (0, self.row_count(b));
            while low < high {
                let mid = low + (high - low) / 2;
                if self.row_extent(b, mid)?.0 <= offset {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            }
            let Some(row) = low.checked_sub(1) else {
                return Some((id, None));
            };
            let (_, end) = self.row_extent(b, row)?;
            if offset > end {
                return Some((id, None));
            }
            let index = b.first + row;
            let value = &self.values[index as usize];
            if value.is_container() && value.b > 0 && offset >= self.value_range(index)?.0 {
                // Inside the brackets of a box of its own, rather than on its key.
                id = value.a;
                continue;
            }
            return Some((id, Some(row)));
        }
    }

    /// The place on screen that shows `place`: itself, or, when it is inside
    /// a collapsed box, the row that the outermost such box is collapsed into.
    pub fn shown(&self, place: Place) -> Place {
        let mut shown = place;
        let mut id = place.0;
        while id != 0 {
            let b = &self.boxes[id as usize];
            if self.is_collapsed(id) {
                let parent = &self.boxes[b.parent as usize];
                shown = (b.parent, Some(b.entry - parent.first));
            }
            id = b.parent;
        }
        shown
    }

    /// The world rectangle of a place, as `(x, y, width, height)`: a row with
    /// all of its lines, or the whole of a box.
    pub fn rect(&self, m: &Metrics, (id, row): Place) -> (f64, f64, f64, f64) {
        let b = &self.boxes[id as usize];
        let (x, w) = (b.x as f64, b.w as f64);
        let Some(row) = row else {
            return (x, self.box_top(b, m), w, self.box_height(b, m));
        };
        let index = b.first + row;
        let expansions = self.expansions(b);
        let extra = expansions
            .binary_search_by_key(&index, |e| e.0)
            .map_or(0, |at| expansions[at].1);
        let lines = 1 + extra as u64;
        (x, self.row_top(b, row, m), w, lines as f64 * m.row_h)
    }

    /// The box whose border a world position is within `margin` of, inside
    /// or out.
    pub fn edge_at(&self, m: &Metrics, x: f64, y: f64, margin: f64) -> Option<u32> {
        let probes = [
            (0.0, 0.0),
            (-margin, 0.0),
            (margin, 0.0),
            (0.0, -margin),
            (0.0, margin),
        ];
        probes.iter().find_map(|&(dx, dy)| {
            let id = self.box_at(m, x + dx, y + dy)?;
            let b = &self.boxes[id as usize];
            let (left, top) = (b.x as f64, self.box_top(b, m));
            let (right, bottom) = (left + b.w as f64, top + self.box_height(b, m));
            let around = left - margin <= x
                && x <= right + margin
                && top - margin <= y
                && y <= bottom + margin;
            let inside =
                left + margin < x && x < right - margin && top + margin < y && y < bottom - margin;
            (around && !inside).then_some(id)
        })
    }

    /// The place at a world position that leads to the source: a whole box
    /// on its border, within `edge` of it, and a row inside it. None on the
    /// control that collapses a box, and away from the boxes.
    pub fn place_at(&self, m: &Metrics, x: f64, y: f64, edge: f64) -> Option<Place> {
        if self.collapsible_at(m, x, y).is_some() {
            return None;
        }
        if let Some(id) = self.edge_at(m, x, y, edge) {
            return Some((id, None));
        }
        self.hit(m, x, y).map(|(id, row)| (id, Some(row)))
    }

    pub fn layout(&mut self, m: &Metrics) {
        for i in 0..self.boxes.len() {
            self.boxes[i].w = self.box_width(&self.boxes[i], m) as f32;
        }
        self.place(m);
    }

    /// Positions every box from the box widths and line counts.
    fn place(&mut self, m: &Metrics) {
        let n = self.boxes.len();

        // Bands, children first so a band can grow to fit its children.
        for i in (0..n).rev() {
            let b = &self.boxes[i];
            let band_h = if self.is_collapsed(i as u32) {
                0.0
            } else {
                self.box_height(b, m).max(self.stacked_height(b, m.gap_y))
            };
            self.boxes[i].band_h = band_h;
        }

        // Positions, parents first.
        self.boxes[0].band_top = 0.0;
        self.boxes[0].x = 0.0;
        for i in 0..n {
            let b = &self.boxes[i];
            let (top, band_h, right) = (b.band_top, b.band_h, b.x + b.w);
            let kids = b.child_first..b.child_first + b.child_count;
            let mut cursor = top + (band_h - self.stacked_height(b, m.gap_y)) / 2.0;
            for id in kids {
                let shown = !self.is_collapsed(id);
                let kid = &mut self.boxes[id as usize];
                kid.x = right + m.gap_x as f32;
                kid.band_top = cursor;
                if shown {
                    cursor += kid.band_h + m.gap_y;
                }
            }
        }

        // Horizontal extent of each subtree, children first.
        for i in (0..n).rev() {
            let b = &self.boxes[i];
            let mut right = b.x + b.w;
            for id in b.child_first..b.child_first + b.child_count {
                if !self.is_collapsed(id) {
                    right = right.max(self.boxes[id as usize].sub_right);
                }
            }
            self.boxes[i].sub_right = right;
        }
    }

    /// Height of the bands of the children of `b` that are shown, stacked
    /// with `gap` between them.
    fn stacked_height(&self, b: &BoxRec, gap: f64) -> f64 {
        let (mut height, mut shown) = (0.0, 0);
        for id in b.child_first..b.child_first + b.child_count {
            if !self.is_collapsed(id) {
                height += self.boxes[id as usize].band_h;
                shown += 1;
            }
        }
        if shown == 0 {
            0.0
        } else {
            height + gap * (shown - 1) as f64
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

fn digits(n: u32) -> u32 {
    n.checked_ilog10().map_or(1, |d| d + 1)
}
