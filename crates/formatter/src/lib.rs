//! json2graph formatter: re-indents JSON source text with Biome's formatter.
//!
//! It is a package of its own, apart from the engine, because Biome makes it
//! ten times the engine's size: the page loads it only when it is asked to
//! format something.

use std::fmt;

use biome_formatter::IndentStyle;
use biome_json_formatter::context::JsonFormatOptions;
use biome_json_formatter::format_node;
use biome_json_parser::{JsonParserOptions, parse_json};
use wasm_bindgen::prelude::*;

/// Why a document was not formatted.
#[derive(Debug, PartialEq, Eq)]
pub enum FormatError {
    /// Biome could not read the text as JSON, for this reason. That is not
    /// only text with a mistake in it: Biome also gives up on a document
    /// nested far less deeply than the engine accepts.
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

/// Formats `source` as Biome does, indented by two spaces: an object or array
/// stays on one line when it fits and was written on one, and is otherwise
/// spread over a line per value.
pub fn format(source: &str) -> Result<String, FormatError> {
    let parsed = parse_json(source, JsonParserOptions::default());
    if let Some(error) = parsed.diagnostics().first() {
        return Err(FormatError::Rejected(error.message.to_string()));
    }
    let options = JsonFormatOptions::default().with_indent_style(IndentStyle::Space);
    let failed = |reason: &dyn fmt::Display| FormatError::Failed(reason.to_string());
    let formatted = format_node(options, &parsed.syntax()).map_err(|e| failed(&e))?;
    let printed = formatted.print().map_err(|e| failed(&e))?;
    Ok(printed.into_code())
}

/// [`format`], for JavaScript.
#[wasm_bindgen]
pub fn format_json(source: &str) -> Result<String, JsError> {
    format(source).map_err(|error| JsError::new(&error.to_string()))
}
