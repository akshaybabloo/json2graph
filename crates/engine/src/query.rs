//! Viewport query: the draw lists for one frame, in screen pixels.
//!
//! The graph is walked top-down and the work is bounded by what can be seen,
//! not by the size of the document:
//!
//! - a subtree whose band or horizontal extent misses the viewport is skipped;
//! - the visible children of a box are found by binary search on their bands;
//! - a subtree only a couple of pixels tall is drawn as one sliver, and
//!   siblings that share a pixel row are stepped over.
//!
//! Coordinates are transformed here in `f64` and emitted as `f32`, so the
//! renderer never handles world coordinates too large for a canvas.

use std::ops::Range;

use crate::layout::{BoxRec, Graph, Metrics, Prefix};
use crate::parse::NONE;
use crate::wrap;

/// Subtrees shorter than this many screen pixels are drawn as a sliver.
const SLIVER_PX: f64 = 2.0;
/// Boxes are clipped this far outside the viewport, enough to keep their
/// rounded corners and border off screen.
const CLIP_MARGIN: f64 = 256.0;
/// At most this many far edges are drawn, per side, to children that are
/// themselves off screen.
const MAX_FAN: usize = 256;
const MAX_ROWS: usize = 50_000;

/// Number of `u32` words per entry of [`Frame::rows`].
pub const ROW_WORDS: usize = 8;

/// How the key of a row is encoded.
pub const KEY_NONE: u32 = 0;
pub const KEY_INDEX: u32 = 1;
pub const KEY_NAME: u32 = 2;

/// Kinds of entry in [`Frame::labels`].
pub const LABEL_NONE: u32 = 0;
pub const LABEL_NAME: u32 = 1;
pub const LABEL_INDEX: u32 = 2;

/// Row flags. A line of an expanded value, shown in full rather than cut to
/// the usual length.
pub const ROW_WRAPPED: u32 = 1 << 16;
/// Not the first line of its value: the key is not repeated.
pub const ROW_CONTINUED: u32 = 1 << 17;
/// The last line shown of a value with more lines than are displayed.
pub const ROW_MORE: u32 = 1 << 18;
/// The first line of the first row of a box.
pub const ROW_FIRST: u32 = 1 << 19;
/// The box of the value in this row is collapsed into the row.
pub const ROW_COLLAPSED: u32 = 1 << 20;

/// Screen = world * `k` + (`x`, `y`).
#[derive(Clone, Copy, Debug)]
pub struct View {
    pub x: f64,
    pub y: f64,
    pub k: f64,
    pub width: f64,
    pub height: f64,
    /// Whether rows are large enough on screen to be worth drawing as text.
    pub text: bool,
}

#[derive(Default)]
pub struct Frame {
    /// `x, y, w, h` per box.
    pub boxes: Vec<f32>,
    /// `x, y, w, h` per collapsed subtree.
    pub slivers: Vec<f32>,
    /// `x1, y1, x2, y2` per edge, from a parent row to the child box.
    pub edges: Vec<f32>,
    /// Edges that cross the viewport on their way to a child that is off
    /// screen, in the same format. There can be a great many of these, so
    /// only a sample is emitted, to be drawn as a faint bundle.
    pub far_edges: Vec<f32>,
    /// [`ROW_WORDS`] words per visible line of text:
    /// `x`, `y` (line centre) and `right` as `f32` bits,
    /// `kind | key_mode << 8 | ROW_*` flags, then the key (`offset, length`,
    /// or `index, label` for an array element, where `label` is a position in
    /// [`Frame::labels`]) and the text (`offset, length`, or `child count, 0`
    /// for containers).
    pub rows: Vec<u32>,
    /// What precedes the `[index]` in the keys of an array's rows, three
    /// words per array: `LABEL_NONE, 0, 0` for the root array,
    /// `LABEL_NAME, offset, length` for a property, or `LABEL_INDEX, index, 0`
    /// for an element of another array.
    pub labels: Vec<u32>,
    stack: Vec<u32>,
}

/// Appends the rows of `b` whose lines fall in `visible`. `place` gives the
/// first three words of a row from its line index.
fn rows(
    g: &Graph,
    src: &[u8],
    m: &Metrics,
    b: &BoxRec,
    visible: Range<u64>,
    place: impl Fn(u64) -> [u32; 3],
    f: &mut Frame,
) {
    let (out, labels) = (&mut f.rows, &mut f.labels);
    let key_mode = if b.entry == NONE {
        KEY_NONE
    } else if g.is_array(b) {
        KEY_INDEX
    } else {
        KEY_NAME
    };
    // The rows of an array share one label, written once.
    let label = labels.len() as u32;
    if key_mode == KEY_INDEX {
        labels.extend(match g.array_prefix(b) {
            Prefix::None => [LABEL_NONE, 0, 0],
            Prefix::Name(offset, len) => [LABEL_NAME, offset, len],
            Prefix::Index(index) => [LABEL_INDEX, index, 0],
        });
    }
    let mut emit = |row: u32, line: u64, flags: u32, text: (u32, u32)| {
        if out.len() >= MAX_ROWS * ROW_WORDS {
            return;
        }
        let value = &g.values[(b.first + row) as usize];
        let key = match key_mode {
            KEY_INDEX => (row, label),
            KEY_NAME => (value.key_off, value.key_len()),
            _ => (0, 0),
        };
        let [x, y, right] = place(line);
        let first = if row == 0 && flags & ROW_CONTINUED == 0 {
            ROW_FIRST
        } else {
            0
        };
        let flags = value.kind() as u32 | key_mode << 8 | flags | first;
        out.extend([x, y, right, flags, key.0, key.1, text.0, text.1]);
    };

    // Runs of one-line rows alternate with expanded rows. `row` and `line`
    // are where the current run starts.
    let count = g.row_count(b);
    let (mut row, mut line) = (0, 0);
    for expansion in g.expansions(b).iter().map(Some).chain([None]) {
        let stop = expansion.map_or(count, |e| e.0 - b.first);
        let run_end = line + (stop - row) as u64;
        for at in visible.start.max(line)..visible.end.min(run_end) {
            let plain = row + (at - line) as u32;
            let value = &g.values[(b.first + plain) as usize];
            let text = if value.is_container() {
                (value.b, 0)
            } else {
                (value.a, value.b)
            };
            // A container that is not empty has a box, whose id is in `a`.
            let collapsed = value.is_container() && value.b > 0 && g.is_collapsed(value.a);
            emit(plain, at, if collapsed { ROW_COLLAPSED } else { 0 }, text);
        }
        let Some(&(_, extra)) = expansion else { break };

        let shown = extra as u64 + 1;
        if run_end < visible.end && run_end + shown > visible.start {
            let value = &g.values[(b.first + stop) as usize];
            let cols = g.value_cols(b, stop, m);
            let mut wrapped = wrap::lines(src, value.a, value.b, cols).peekable();
            for n in 0..shown {
                let Some(text) = wrapped.next() else { break };
                if !visible.contains(&(run_end + n)) {
                    continue;
                }
                let mut flags = ROW_WRAPPED;
                if n > 0 {
                    flags |= ROW_CONTINUED;
                }
                if n == shown - 1 && wrapped.peek().is_some() {
                    flags |= ROW_MORE;
                }
                emit(stop, run_end + n, flags, text);
            }
        }
        row = stop + 1;
        line = run_end + shown;
    }
}

impl View {
    /// The viewport in world coordinates: left, top, right, bottom.
    fn world(&self) -> [f64; 4] {
        [
            -self.x / self.k,
            -self.y / self.k,
            (self.width - self.x) / self.k,
            (self.height - self.y) / self.k,
        ]
    }

    fn sx(&self, x: f64) -> f32 {
        (x * self.k + self.x) as f32
    }

    fn sy(&self, y: f64) -> f32 {
        (y * self.k + self.y) as f32
    }
}

impl Frame {
    fn clear(&mut self) {
        self.boxes.clear();
        self.slivers.clear();
        self.edges.clear();
        self.far_edges.clear();
        self.rows.clear();
        self.labels.clear();
    }
}

/// Appends `b`, whose top edge is at `top`, and its rows, if it is in the
/// viewport.
fn draw_box(g: &Graph, src: &[u8], m: &Metrics, v: &View, b: &BoxRec, top: f64, f: &mut Frame) {
    let [x0, y0, x1, y1] = v.world();
    let (left, right) = (b.x as f64, b.x as f64 + b.w as f64);
    let bottom = top + g.box_height(b, m);
    if left > x1 || right < x0 || top > y1 || bottom < y0 {
        return;
    }

    let screen_top = (top * v.k + v.y).max(-CLIP_MARGIN);
    let screen_bottom = (bottom * v.k + v.y).min(v.height + CLIP_MARGIN);
    f.boxes.extend([
        v.sx(left),
        screen_top as f32,
        // Never thinner than a pixel, so a box cannot vanish.
        (b.w as f64 * v.k).max(1.0) as f32,
        (screen_bottom - screen_top).max(1.0) as f32,
    ]);
    if v.text {
        let rows_top = top + m.pad_y;
        let visible = ((y0 - rows_top) / m.row_h).floor().max(0.0) as u64
            ..((y1 - rows_top) / m.row_h).ceil().max(0.0) as u64;
        let text_left = v.sx(left + m.pad_x).to_bits();
        let text_right = v.sx(right - m.pad_x).to_bits();
        let place = |line: u64| {
            let centre = v.sy(rows_top + (line as f64 + 0.5) * m.row_h);
            [text_left, centre.to_bits(), text_right]
        };
        rows(g, src, m, b, visible, place, f);
    }
}

pub fn query(g: &Graph, src: &[u8], m: &Metrics, v: &View, f: &mut Frame) {
    f.clear();

    let k = v.k;
    let [x0, y0, x1, y1] = v.world();
    let (sx, sy) = (|x| v.sx(x), |y| v.sy(y));
    let pixel = 1.0 / k;

    let root = &g.boxes[0];
    if root.band_h < y0 || y1 < 0.0 || (root.sub_right as f64) < x0 || x1 < 0.0 {
        return;
    }
    f.stack.push(0);

    while let Some(id) = f.stack.pop() {
        let b = &g.boxes[id as usize];
        let right = b.x as f64 + b.w as f64;
        let top = g.box_top(b, m);
        draw_box(g, src, m, v, b, top, f);

        let kids = g.children(b);
        if kids.is_empty() {
            continue;
        }
        let kid_left = kids[0].x as f64;
        let gap_visible = right <= x1 && kid_left >= x0;
        let kids_visible = kid_left <= x1;
        if !gap_visible && !kids_visible {
            continue;
        }

        // An edge leaves the parent at the row that holds the child and enters
        // the child at its vertical centre.
        let source_y = |c: &BoxRec| {
            let line = g.row_line(b, c.entry - b.first);
            top + m.pad_y + (line as f64 + 0.5) * m.row_h
        };
        let target_y = |c: &BoxRec| c.band_top + c.band_h / 2.0;
        let edge = |c: &BoxRec| [sx(right), sy(source_y(c)), sx(kid_left), sy(target_y(c))];

        // Children whose band intersects the viewport vertically.
        let start = kids.partition_point(|c| c.band_top + c.band_h < y0);
        let end = kids.partition_point(|c| c.band_top <= y1);
        let mut i = start;
        while i < end {
            let c = &kids[i];
            if g.is_collapsed(b.child_first + i as u32) {
                i += 1;
                continue;
            }
            if gap_visible {
                f.edges.extend(edge(c));
            }
            if kids_visible && c.sub_right as f64 >= x0 {
                if c.band_h * k < SLIVER_PX {
                    f.slivers.extend([
                        sx(kid_left),
                        sy(c.band_top),
                        ((c.sub_right as f64 - kid_left) * k).max(1.0) as f32,
                        (c.band_h * k).max(1.0) as f32,
                    ]);
                } else {
                    f.stack.push(b.child_first + i as u32);
                }
            }
            i += 1;
            if c.band_h < pixel {
                // Skip the siblings that fall in the same pixel row.
                let next_row = c.band_top + pixel;
                i += kids[i..end].partition_point(|n| n.band_top < next_row);
            }
        }

        if gap_visible {
            // Edges to children above or below the viewport still cross it
            // when their source row is on the other side. Both ends move down
            // monotonically with the child index, so those children form one
            // run on each side.
            let above = kids[..start].partition_point(|c| source_y(c).max(target_y(c)) < y0);
            let below = end + kids[end..].partition_point(|c| source_y(c).min(target_y(c)) <= y1);
            for run in [above..start, end..below] {
                let stride = run.len().div_ceil(MAX_FAN).max(1);
                for i in run.step_by(stride) {
                    if !g.is_collapsed(b.child_first + i as u32) {
                        f.far_edges.extend(edge(&kids[i]));
                    }
                }
            }
        }
    }
}

/// Fills the draw lists with only the path from the root to box `target`:
/// the boxes on it and the edges between them. Drawn over a dimmed frame, it
/// shows how the document leads to that box.
pub fn query_path(g: &Graph, src: &[u8], m: &Metrics, v: &View, target: u32, f: &mut Frame) {
    f.clear();
    let [x0, y0, x1, y1] = v.world();

    let Some(mut b) = g.boxes.get(target as usize) else {
        return;
    };
    let mut top = g.box_top(b, m);
    loop {
        draw_box(g, src, m, v, b, top, f);
        if b.parent == NONE {
            return;
        }
        let parent = &g.boxes[b.parent as usize];
        let parent_top = g.box_top(parent, m);

        // The edge between them, as in `query`. It is drawn even when both of
        // its ends are off screen, so the path is never interrupted.
        let line = g.row_line(parent, b.entry - parent.first);
        let (from_x, to_x) = (parent.x as f64 + parent.w as f64, b.x as f64);
        let from_y = parent_top + m.pad_y + (line as f64 + 0.5) * m.row_h;
        let to_y = b.band_top + b.band_h / 2.0;
        if from_x <= x1 && to_x >= x0 && from_y.min(to_y) <= y1 && from_y.max(to_y) >= y0 {
            f.edges
                .extend([v.sx(from_x), v.sy(from_y), v.sx(to_x), v.sy(to_y)]);
        }
        (b, top) = (parent, parent_top);
    }
}
