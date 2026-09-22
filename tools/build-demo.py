#!/usr/bin/env python3
"""
Assembles demo/tour-website-demo.html from demo/_source.html by inlining the
web font as base64.

Why a build step at all: the deliverable has to be one file the client can
double-click with no internet connection, so the font cannot be a separate
request. Keeping the source separate means the 42kB base64 blob never has to be
edited by hand.

    python3 tools/build-demo.py
"""

import base64
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "demo" / "_source.html"
FONT = ROOT / "public" / "fonts" / "karla-latin-normal.woff2"
OUT = ROOT / "demo" / "tour-website-demo.html"

TOKEN = "__KARLA_B64__"


def main() -> int:
    for path in (SOURCE, FONT):
        if not path.exists():
            sys.stderr.write(f"missing: {path}\n")
            return 1

    html = SOURCE.read_text(encoding="utf-8")
    if TOKEN not in html:
        sys.stderr.write(f"{TOKEN} not found in {SOURCE.name}\n")
        return 1

    b64 = base64.b64encode(FONT.read_bytes()).decode("ascii")
    html = html.replace(TOKEN, b64)

    # Anything left looking like a placeholder means the build is half-done.
    if "__" in html.replace("__KARLA", ""):
        leftovers = {w for w in html.split() if w.startswith("__")}
        if leftovers:
            sys.stderr.write(f"unresolved placeholders: {sorted(leftovers)}\n")
            return 1

    OUT.write_text(html, encoding="utf-8")
    kb = len(html.encode("utf-8")) / 1024
    sys.stdout.write(f"wrote {OUT.relative_to(ROOT)}  ({kb:.0f} kB, self-contained)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
