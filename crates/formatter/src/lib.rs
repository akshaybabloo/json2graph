//! json2graph formatter: re-indents JSON and YAML source text with Biome's
//! formatters.
//!
//! It is a package of its own, apart from the engine, because Biome makes it
//! ten times the engine's size: the page loads it only when it is asked to
//! format something.

use std::fmt;

use biome_formatter::IndentStyle;
use biome_json_formatter::context::JsonFormatOptions;
use biome_json_parser::{JsonParserOptions, parse_json};
use biome_yaml_formatter::YamlFormatOptions;
use biome_yaml_parser::parse_yaml;
use wasm_bindgen::prelude::*;

/// Why a document was not formatted.
#[derive(Debug, PartialEq, Eq)]
pub enum FormatError {
    /// Biome could not read the text, for this reason. That is not only text
    /// with a mistake in it: Biome also gives up on a JSON document nested far
    /// less deeply than the engine accepts.
    Rejected(String),
    /// The formatter gave up, with this explanation.
    Failed(String),
}

impl fmt::Display for FormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FormatError::Rejected(reason) | FormatError::Failed(reason) => f.write_str(reason),
        }
    }
}

fn failed(reason: impl fmt::Display) -> FormatError {
    FormatError::Failed(reason.to_string())
}

/// Formats JSON `source` as Biome does, indented by two spaces: an object or
/// array stays on one line when it fits and was written on one, and is
/// otherwise spread over a line per value.
pub fn json(source: &str) -> Result<String, FormatError> {
    let parsed = parse_json(source, JsonParserOptions::default());
    if let Some(error) = parsed.diagnostics().first() {
        return Err(FormatError::Rejected(error.message.to_string()));
    }
    let options = JsonFormatOptions::default().with_indent_style(IndentStyle::Space);
    let formatted = biome_json_formatter::format_node(options, &parsed.syntax()).map_err(failed)?;
    Ok(formatted.print().map_err(failed)?.into_code())
}

/// How deeply a YAML document may nest. Biome's YAML parser has no limit of
/// its own, and runs out of stack in WebAssembly a little beyond this.
pub const MAX_YAML_DEPTH: usize = 500;

/// Formats YAML `source` as Biome does, indented by two spaces, with its
/// comments kept.
pub fn yaml(source: &str) -> Result<String, FormatError> {
    if yaml_depth(source) > MAX_YAML_DEPTH {
        return Err(FormatError::Rejected(format!(
            "The document is nested more than {MAX_YAML_DEPTH} levels deep"
        )));
    }
    let parsed = parse_yaml(source);
    if let Some(error) = parsed.diagnostics().first() {
        return Err(FormatError::Rejected(error.message.to_string()));
    }
    let formatted =
        biome_yaml_formatter::format_node(YamlFormatOptions::default(), &parsed.syntax())
            .map_err(failed)?;
    Ok(formatted.print().map_err(failed)?.into_code())
}

/// How deeply YAML `source` nests, or more: each indentation, each `- ` that
/// starts a sequence within a line, and each bracket or brace still open is a
/// level. Brackets in strings and in block scalars count too.
fn yaml_depth(source: &str) -> usize {
    let mut indents: Vec<usize> = Vec::new();
    let mut flow = 0;
    let mut deepest = 0;
    for line in source.lines() {
        let text = line.trim_start_matches(' ');
        if text.is_empty() || text.starts_with('#') {
            continue;
        }
        let indent = line.len() - text.len();
        if flow == 0 {
            while indents.last().is_some_and(|&last| last >= indent) {
                indents.pop();
            }
            indents.push(indent);
        }
        let mut rest = text;
        let mut sequences = 0;
        while let Some(after) = rest.strip_prefix("- ") {
            sequences += 1;
            rest = after.trim_start_matches(' ');
        }
        // The lines at the top are at no depth.
        let block = indents.len() - 1 + sequences;
        deepest = deepest.max(block + flow);
        let mut after_space = true;
        for byte in rest.bytes() {
            match byte {
                b'#' if after_space => break,
                b'[' | b'{' => {
                    flow += 1;
                    deepest = deepest.max(block + flow);
                }
                b']' | b'}' => flow = usize::saturating_sub(flow, 1),
                _ => {}
            }
            after_space = byte == b' ' || byte == b'\t';
        }
    }
    deepest
}

/// [`json`], for JavaScript.
#[wasm_bindgen]
pub fn format_json(source: &str) -> Result<String, JsError> {
    json(source).map_err(|error| JsError::new(&error.to_string()))
}

/// [`yaml`], for JavaScript.
#[wasm_bindgen]
pub fn format_yaml(source: &str) -> Result<String, JsError> {
    yaml(source).map_err(|error| JsError::new(&error.to_string()))
}
