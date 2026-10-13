#!/usr/bin/env bash
# Writes the comment about the preview on a pull request, or rewrites the one
# that is already there, so that a pull request only ever has one.
#
#   preview-comment.sh <pull request number> <text>
set -euo pipefail

MARK='<!-- json2graph-preview -->'
pr=$1
body="$MARK
$2"

comments="repos/$GITHUB_REPOSITORY/issues/$pr/comments"
ids=$(gh api "$comments" --paginate --jq ".[] | select(.body | startswith(\"$MARK\")) | .id")
id=${ids%%$'\n'*}

if [ -n "$id" ]; then
	gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body" --silent
else
	gh api --method POST "$comments" -f body="$body" --silent
fi
