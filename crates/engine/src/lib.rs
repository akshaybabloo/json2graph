//! json2graph engine: indexes a JSON or CSV document, lays it out as a graph
//! of boxes and answers "what is visible in this viewport" for the renderer.
//!
//! The JavaScript side writes the source bytes straight into [`Document`]'s
//! buffer and reads the draw lists back out of WebAssembly memory, so neither
//! the document nor the graph is ever copied into JavaScript objects.

pub mod csv;
pub mod layout;
pub mod parse;
pub mod query;
pub mod wrap;

use csv::CsvParser;
use layout::{Graph, Metrics, Place};
use parse::{Index, NONE, ParseError, Parser};
use query::{Frame, View};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Document {
    source: Vec<u8>,
    parser: Option<Indexer>,
    graph: Option<Graph>,
    metrics: Option<Metrics>,
    frame: Frame,
}

#[wasm_bindgen]
impl Document {
    /// Allocates room for `size` bytes of JSON, to be written at `source_ptr`.
    #[wasm_bindgen(constructor)]
    pub fn new(size: usize) -> Document {
        Document {
            source: vec![0; size],
            parser: Some(Indexer::Json(Parser::new())),
            graph: None,
            metrics: None,
            frame: Frame::default(),
        }
    }

    /// Indexes the source as CSV rather than JSON: an array with an object
    /// for each record after the first, which names the columns. Called
    /// before `parse`.
    pub fn csv(&mut self, delimiter: u8) {
        self.parser = Some(Indexer::Csv(CsvParser::new(delimiter)));
    }

    pub fn source_ptr(&self) -> usize {
        self.source.as_ptr() as usize
    }

    /// Parses roughly `budget` more bytes. Returns `true` when the document
    /// is fully indexed.
    pub fn parse(&mut self, budget: usize) -> Result<bool, JsError> {
        let Some(parser) = self.parser.as_mut() else {
            return Ok(true);
        };
        match parser.step(&self.source, budget) {
            Ok(false) => Ok(false),
            Ok(true) => {
                let index = self.parser.take().unwrap().index();
                self.graph = Some(Graph::from_index(index));
                Ok(true)
            }
            Err(error) => {
                let (line, column) = error.line_col(&self.source);
                Err(JsError::new(&format!(
                    "{} (line {line}, column {column})",
                    error.message
                )))
            }
        }
    }

    pub fn parsed_bytes(&self) -> usize {
        self.parser
            .as_ref()
            .map_or(self.source.len(), Indexer::position)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn layout(
        &mut self,
        char_w: f64,
        row_h: f64,
        pad_x: f64,
        pad_y: f64,
        gap_x: f64,
        gap_y: f64,
        toggle_w: f64,
        max_key: u32,
        max_val: u32,
    ) {
        let metrics = Metrics {
            char_w,
            row_h,
            pad_x,
            pad_y,
            gap_x,
            gap_y,
            toggle_w,
            max_key,
            max_val,
        };
        self.graph_mut().layout(&metrics);
        self.metrics = Some(metrics);
    }

    pub fn value_count(&self) -> usize {
        self.graph().values.len()
    }

    pub fn box_count(&self) -> usize {
        self.graph().boxes.len()
    }

    pub fn width(&self) -> f64 {
        self.graph().size().0
    }

    pub fn height(&self) -> f64 {
        self.graph().size().1
    }

    pub fn root_width(&self) -> f64 {
        self.graph().boxes[0].w as f64
    }

    pub fn root_top(&self) -> f64 {
        let graph = self.graph();
        graph.box_top(&graph.boxes[0], self.metrics())
    }

    pub fn root_height(&self) -> f64 {
        let graph = self.graph();
        graph.box_height(&graph.boxes[0], self.metrics())
    }

    /// Fills the draw lists for a viewport `width` x `height` screen pixels
    /// where screen = world * `k` + (`x`, `y`).
    pub fn query(&mut self, x: f64, y: f64, k: f64, width: f64, height: f64, text: bool) {
        let view = View {
            x,
            y,
            k,
            width,
            height,
            text,
        };
        let graph = self.graph.as_ref().expect("document is not parsed yet");
        let metrics = self.metrics.as_ref().expect("document is not laid out yet");
        query::query(graph, &self.source, metrics, &view, &mut self.frame);
    }

    /// Like [`Document::query`], but for only the path from the root to the
    /// box `target` (see [`Document::box_at`]).
    #[allow(clippy::too_many_arguments)]
    pub fn query_path(
        &mut self,
        target: u32,
        x: f64,
        y: f64,
        k: f64,
        width: f64,
        height: f64,
        text: bool,
    ) {
        let view = View {
            x,
            y,
            k,
            width,
            height,
            text,
        };
        let graph = self.graph.as_ref().expect("document is not parsed yet");
        let metrics = self.metrics.as_ref().expect("document is not laid out yet");
        query::query_path(graph, &self.source, metrics, &view, target, &mut self.frame);
    }

    /// The box at a screen position, under the view transform (`x`, `y`,
    /// `k`), or `u32::MAX` where there is none.
    pub fn box_at(&self, x: f64, y: f64, k: f64, screen_x: f64, screen_y: f64) -> u32 {
        self.graph()
            .box_at(self.metrics(), (screen_x - x) / k, (screen_y - y) / k)
            .unwrap_or(parse::NONE)
    }

    /// Whether a screen position, under the view transform (`x`, `y`, `k`), is
    /// on the control that collapses a box or shows it again.
    pub fn collapsible_at(&self, x: f64, y: f64, k: f64, screen_x: f64, screen_y: f64) -> bool {
        let (x, y) = ((screen_x - x) / k, (screen_y - y) / k);
        self.graph().collapsible_at(self.metrics(), x, y).is_some()
    }

    /// Whether a click at a screen position, under the view transform
    /// (`x`, `y`, `k`), would do something: expand a value or collapse it
    /// again, or collapse a box or show it again.
    pub fn expandable_at(&self, x: f64, y: f64, k: f64, screen_x: f64, screen_y: f64) -> bool {
        let (graph, metrics) = (self.graph(), self.metrics());
        let (x, y) = ((screen_x - x) / k, (screen_y - y) / k);
        graph.collapsible_at(metrics, x, y).is_some()
            || graph
                .hit(metrics, x, y)
                .is_some_and(|(id, row)| graph.is_expandable(metrics, id, row))
    }

    /// Acts on a click at a screen position. On the control of a row, at the
    /// right edge of its box, it collapses the box of the value there, or shows it again.
    /// Elsewhere on a value that is cut short, it expands the value onto
    /// wrapped lines, or collapses it again. Returns how far down the clicked
    /// row moved, in world pixels, or NaN if there was nothing to do there.
    pub fn toggle_at(&mut self, x: f64, y: f64, k: f64, screen_x: f64, screen_y: f64) -> f64 {
        let metrics = *self.metrics();
        let graph = self.graph.as_mut().expect("document is not parsed yet");
        let (x, y) = ((screen_x - x) / k, (screen_y - y) / k);
        let moved = if let Some(id) = graph.collapsible_at(&metrics, x, y) {
            graph.toggle_box(&metrics, id)
        } else {
            graph
                .hit(&metrics, x, y)
                .and_then(|(id, row)| graph.toggle(&self.source, &metrics, id, row))
        };
        moved.unwrap_or(f64::NAN)
    }

    /// The row or box at a screen position, under the view transform (`x`,
    /// `y`, `k`), and where it is in the source: `[box, row, start, end]`,
    /// with the row `u32::MAX` for a whole box and the range in bytes. A box
    /// is had within `edge` screen pixels of its border, and the value of a
    /// row inside it. Empty where nothing leads to the source, as on the
    /// control that collapses a box.
    pub fn source_at(
        &self,
        x: f64,
        y: f64,
        k: f64,
        screen_x: f64,
        screen_y: f64,
        edge: f64,
    ) -> Vec<u32> {
        let graph = self.graph();
        let (x, y) = ((screen_x - x) / k, (screen_y - y) / k);
        let Some(place) = graph.place_at(self.metrics(), x, y, edge / k) else {
            return Vec::new();
        };
        let Some((start, end)) = graph.source_range(place) else {
            return Vec::new();
        };
        let (id, row) = place;
        vec![id, row.unwrap_or(NONE), start, end]
    }

    /// The row or box that shows byte `offset` of the source, however deep,
    /// as `[box, row]` with the row `u32::MAX` for a whole box. Empty outside
    /// the document.
    pub fn locate(&self, offset: u32) -> Vec<u32> {
        self.graph()
            .locate(offset)
            .map_or_else(Vec::new, |(id, row)| vec![id, row.unwrap_or(NONE)])
    }

    /// The row or box on screen that shows `row` of box `id`: itself, or the
    /// row of the collapsed box it is inside. As `[box, row]`, like `locate`.
    pub fn shown(&self, id: u32, row: u32) -> Vec<u32> {
        let (id, row) = self.graph().shown(place(id, row));
        vec![id, row.unwrap_or(NONE)]
    }

    /// The world rectangle of `row` of box `id`, or of the whole box when
    /// `row` is `u32::MAX`, as `[x, y, width, height]`.
    pub fn place_rect(&self, id: u32, row: u32) -> Vec<f64> {
        let (x, y, w, h) = self.graph().rect(self.metrics(), place(id, row));
        vec![x, y, w, h]
    }

    /// Collapses every box into its row, leaving the root, or shows every box
    /// again.
    pub fn collapse_all(&mut self, collapsed: bool) {
        let metrics = *self.metrics();
        self.graph_mut().set_all_collapsed(&metrics, collapsed);
    }

    pub fn boxes_ptr(&self) -> usize {
        self.frame.boxes.as_ptr() as usize
    }

    pub fn boxes_len(&self) -> usize {
        self.frame.boxes.len()
    }

    pub fn slivers_ptr(&self) -> usize {
        self.frame.slivers.as_ptr() as usize
    }

    pub fn slivers_len(&self) -> usize {
        self.frame.slivers.len()
    }

    pub fn edges_ptr(&self) -> usize {
        self.frame.edges.as_ptr() as usize
    }

    pub fn edges_len(&self) -> usize {
        self.frame.edges.len()
    }

    pub fn edge_bends_ptr(&self) -> usize {
        self.frame.edge_bends.as_ptr() as usize
    }

    pub fn edge_bends_len(&self) -> usize {
        self.frame.edge_bends.len()
    }

    pub fn far_edge_bends_ptr(&self) -> usize {
        self.frame.far_edge_bends.as_ptr() as usize
    }

    pub fn far_edge_bends_len(&self) -> usize {
        self.frame.far_edge_bends.len()
    }

    pub fn edge_keys_ptr(&self) -> usize {
        self.frame.edge_keys.as_ptr() as usize
    }

    pub fn edge_keys_len(&self) -> usize {
        self.frame.edge_keys.len()
    }

    pub fn far_edges_ptr(&self) -> usize {
        self.frame.far_edges.as_ptr() as usize
    }

    pub fn far_edges_len(&self) -> usize {
        self.frame.far_edges.len()
    }

    pub fn labels_ptr(&self) -> usize {
        self.frame.labels.as_ptr() as usize
    }

    pub fn labels_len(&self) -> usize {
        self.frame.labels.len()
    }

    pub fn rows_ptr(&self) -> usize {
        self.frame.rows.as_ptr() as usize
    }

    pub fn rows_len(&self) -> usize {
        self.frame.rows.len()
    }
}

/// A place from JavaScript, where `u32::MAX` stands for no row.
fn place(id: u32, row: u32) -> Place {
    (id, (row != NONE).then_some(row))
}

impl Document {
    fn graph(&self) -> &Graph {
        self.graph.as_ref().expect("document is not parsed yet")
    }

    fn graph_mut(&mut self) -> &mut Graph {
        self.graph.as_mut().expect("document is not parsed yet")
    }

    fn metrics(&self) -> &Metrics {
        self.metrics.as_ref().expect("document is not laid out yet")
    }
}

/// What indexes the source, by its format.
enum Indexer {
    Json(Parser),
    Csv(CsvParser),
}

impl Indexer {
    fn step(&mut self, src: &[u8], budget: usize) -> Result<bool, ParseError> {
        match self {
            Indexer::Json(parser) => parser.step(src, budget),
            Indexer::Csv(parser) => parser.step(src, budget),
        }
    }

    fn position(&self) -> usize {
        match self {
            Indexer::Json(parser) => parser.position(),
            Indexer::Csv(parser) => parser.position(),
        }
    }

    fn index(self) -> Index {
        match self {
            Indexer::Json(parser) => parser.index(),
            Indexer::Csv(parser) => parser.index(),
        }
    }
}
