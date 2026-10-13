#![allow(dead_code)]

use json2graph_engine::layout::{Graph, Metrics};
use json2graph_engine::parse::parse;

pub const METRICS: Metrics = Metrics {
    char_w: 7.0,
    row_h: 20.0,
    pad_x: 10.0,
    pad_y: 6.0,
    gap_x: 60.0,
    gap_y: 16.0,
    toggle_w: 18.0,
    max_key: 32,
    max_val: 48,
};

pub fn graph(src: &str) -> Graph {
    let mut graph = Graph::new(parse(src.as_bytes()).unwrap());
    graph.layout(&METRICS);
    graph
}
