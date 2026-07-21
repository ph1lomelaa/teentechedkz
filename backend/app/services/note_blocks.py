"""Markdown конспект → visibility blocks (Приоритет 3, срез 2).

A "block" is a markdown section: a heading (`#`/`##`/`###`) plus everything up
to the next heading. Managers hide individual blocks from the student view;
`hidden_blocks` stores the block keys (the heading text). Any content before the
first heading is an intro block that is always shown (not toggleable).
"""
from __future__ import annotations

import re

_HEADING = re.compile(r"^(#{1,3})\s+(.*\S)\s*$")


def split_blocks(md: str | None) -> list[dict]:
    """Split into [{key, heading, content}]. `content` keeps the heading line so
    joining blocks back reconstructs the document. Intro (pre-heading) has an
    empty heading/key."""
    if not md:
        return []
    blocks: list[dict] = []
    current: dict | None = None

    def flush() -> None:
        if current is None:
            return
        content = "\n".join(current["lines"]).strip()
        if content or current["heading"]:
            blocks.append(
                {"key": current["heading"], "heading": current["heading"], "content": content}
            )

    for line in md.splitlines():
        m = _HEADING.match(line)
        if m:
            flush()
            heading = m.group(2).strip()
            current = {"heading": heading, "lines": [line]}
        else:
            if current is None:
                current = {"heading": "", "lines": []}
            current["lines"].append(line)
    flush()
    return blocks


def block_headings(md: str | None) -> list[dict]:
    """Toggleable blocks (those with a heading), as [{key, heading}]."""
    return [{"key": b["key"], "heading": b["heading"]} for b in split_blocks(md) if b["heading"]]


def filter_visible(md: str | None, hidden_keys: list[str] | None) -> str:
    """Reconstruct the markdown with hidden blocks removed."""
    hidden = set(hidden_keys or [])
    kept = [b["content"] for b in split_blocks(md) if b["key"] not in hidden]
    return "\n\n".join(kept).strip()
