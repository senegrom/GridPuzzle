"""Renderer fonts: explicit resources fail fast; discovery has a bundled fallback."""
from pathlib import Path

from PIL import ImageFont

CANDIDATES = ("arial.ttf", "times.ttf", "calibri.ttf", "verdana.ttf", "georgia.ttf",
              "DejaVuSans.ttf", "LiberationSans-Regular.ttf")


def font(name: str | None, size: int):
    # Pillow >=10.1 includes a scalable Aileron default; it needs no OS fonts.
    face = ImageFont.load_default(size=size) if name is None else ImageFont.truetype(name, size)
    if not isinstance(face, ImageFont.FreeTypeFont):
        raise RuntimeError("Scalable fonts require Pillow with FreeType; install the corpus extra")
    return face


def resolve_fonts(files=(), directories=()) -> tuple[str | None, ...]:
    """Check fonts before output mutation. Explicit configuration is strict."""
    requested = [str(Path(p).expanduser()) for p in files]
    for name in directories:
        directory = Path(name).expanduser()
        if not directory.is_dir():
            raise ValueError(f"Font directory does not exist: {directory}")
        found = sorted(str(p) for p in directory.iterdir()
                       if p.is_file() and p.suffix.lower() in (".ttf", ".otf", ".ttc"))
        if not found:
            raise ValueError(f"No font files found in {directory}")
        requested.extend(found)
    available = []
    for name in dict.fromkeys(requested or CANDIDATES):
        try:
            face = font(name, 24)
            # Required label characters are deliberately ASCII: the bundled
            # fallback does not contain mathematical minus/multiply/divide.
            missing = bytes(face.getmask("\u0378"))
            if any(bytes(face.getmask(c)) == missing for c in "0123456789+-x/"):
                raise ValueError("missing a required digit or arithmetic glyph")
        except (OSError, ValueError) as error:
            if requested:
                raise ValueError(f"Cannot use font {name}: {error}") from error
            continue
        available.append(name)
    if not available:
        font(None, 24)  # also preflight the FreeType-backed bundled fallback
        available.append(None)
    return tuple(available)
