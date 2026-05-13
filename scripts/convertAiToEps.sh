#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND_DIR="$ROOT/partner-logo-branding"
OUT_BASE="$ROOT/public/logo"

files=(
  "apia-logo-icon-cmyk.ai"
  "apia-logo-vert-cmyk.ai"
)

echo "Conversion helper: will try magick, inkscape, or gs to convert .ai -> .eps"

which_magick() { command -v magick >/dev/null 2>&1; }
which_convert() { command -v convert >/dev/null 2>&1; }
which_inkscape() { command -v inkscape >/dev/null 2>&1; }
which_gs() { command -v gs >/dev/null 2>&1; }

for f in "${files[@]}"; do
  src="$BRAND_DIR/$f"
  if [ ! -f "$src" ]; then
    echo "Warning: source not found: $src"
    continue
  fi
  name="$(basename "$f" .ai)"
  slug="$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g' | sed -E 's/^-+|-+$//g')"
  for type in partners organizations; do
    dest_dir="$OUT_BASE/$type/$slug"
    mkdir -p "$dest_dir"
    dest_eps="$dest_dir/favicon.eps"

    if which_magick || which_convert; then
      echo "Using ImageMagick to convert $src -> $dest_eps"
      if command -v magick >/dev/null 2>&1; then
        magick "$src" -colorspace RGB "$dest_eps"
      else
        convert "$src" -colorspace RGB "$dest_eps"
      fi
    elif which_inkscape; then
      echo "Using Inkscape to convert $src -> $dest_eps"
      inkscape "$src" --export-filename="$dest_eps"
    elif which_gs; then
      echo "Using Ghostscript pipeline to convert $src -> $dest_eps"
      tmp_pdf="/tmp/$slug.pdf"
      # Some AI files are PDF-compatible; try renaming to .pdf then gs
      cp "$src" "$tmp_pdf"
      gs -dNOPAUSE -dBATCH -sDEVICE=eps2write -sOutputFile="$dest_eps" "$tmp_pdf"
      rm -f "$tmp_pdf"
    else
      echo "No conversion tool found (magick/convert, inkscape, gs). Skipping $src"
      echo "Please run this script on a machine with ImageMagick or Inkscape installed, or export EPS from Adobe Illustrator." >&2
      continue
    fi
    echo "Wrote $dest_eps"
  done
done

echo "Done."
