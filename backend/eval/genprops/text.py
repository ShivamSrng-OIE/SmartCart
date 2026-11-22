"""Render listing facts as a description or a small standalone spec sheet."""

from collections.abc import Mapping
from textwrap import wrap
from typing import Literal

Level = Literal["subtle", "more", "less"]
_FOOTNOTE_SIZE = {"subtle": 6, "more": 8, "less": 4}


def _field(source, name, default=None):
    if isinstance(source, Mapping):
        return source.get(name, default)
    return getattr(source, name, default)


def _one_line(value: str) -> str:
    return " ".join(value.split())


def _listing_lines(item) -> list[str]:
    title = _field(item, "title") or _field(_field(item, "product"), "title")
    facts = _field(item, "clean_facts", _field(item, "facts", ()))
    if isinstance(facts, Mapping):
        facts = [f"{label.replace('_', ' ').capitalize()}: {value}" for label, value in facts.items()]
    elif isinstance(facts, str):
        facts = facts.splitlines()
    return [line for value in (title, *(facts or ())) if value and (line := _one_line(str(value)))]


def _flaw_line(flaw) -> str:
    if isinstance(flaw, str):
        command = flaw
    else:
        command = _field(flaw, "agent_command") or _field(flaw, "command") or _field(flaw, "text")
    if not isinstance(command, str) or not (line := _one_line(command)):
        raise ValueError("flaw must supply a nonempty agent_command")
    return line


def render_description(item, flaw=None) -> str:
    """Append a single fulfillment note when a flaw is supplied."""
    lines = _listing_lines(item)
    if flaw is not None:
        lines.append(f"Fulfillment note: {_flaw_line(flaw)}")
    return "\n".join(lines)


def _pdf_line(line: str, size: int, y: int) -> bytes:
    literal = line.encode("cp1252", errors="replace")
    literal = literal.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
    return f"BT /F1 {size} Tf 48 {y} Td (".encode("ascii") + literal + b") Tj ET\n"


def render_spec_pdf(item, flaw=None, *, level: Level | None = None) -> bytes:
    """Write a one-page PDF with a WinAnsi Helvetica font and an optional footnote."""
    footnote_lines = []
    if flaw is not None:
        size = _FOOTNOTE_SIZE[level if level is not None else _field(flaw, "level", "subtle")]
        footnote_lines = wrap(f"1. {_flaw_line(flaw)}", width=516 // size)
    content = []
    bottom = 48
    for line in reversed(footnote_lines):
        content.append(_pdf_line(line, size, bottom))
        bottom += size + 2
    content.reverse()

    y = 744
    for index, line in enumerate(_listing_lines(item)):
        size = 16 if index == 0 else 11
        for segment in wrap(line, width=516 // size):
            if y < bottom + 16:
                raise ValueError("listing does not fit on a one-page spec sheet")
            content.append(_pdf_line(segment, size, y))
            y -= size + 4
    stream = b"".join(content)

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
         b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{number} 0 obj\n".encode("ascii") + body + b"\nendobj\n")
    xref = len(pdf)
    count = len(objects) + 1
    pdf.extend(f"xref\n0 {count}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    return bytes(pdf)
