import * as React from 'react'

const FONT_SIZE = 14
const TILE_HEIGHT = 160

function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/**
 * Static, semi-transparent watermark tiled across shared media. One SVG tile
 * repeated as a CSS background: a single paint, no animation, and
 * pointer-events-none so the player underneath stays fully usable.
 */
export function ShareWatermark({ text }: { readonly text: string }) {
  const backgroundImage = React.useMemo(() => {
    // Monospace glyphs are ~0.6em wide; pad so neighbouring tiles never touch.
    const width = Math.max(240, Math.ceil(text.length * FONT_SIZE * 0.6) + 96)
    const cx = width / 2
    const cy = TILE_HEIGHT / 2
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${TILE_HEIGHT}">` +
      `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" ` +
      `transform="rotate(-24 ${cx} ${cy})" font-family="ui-monospace,monospace" font-size="${FONT_SIZE}" ` +
      `fill="#fff" fill-opacity="0.22" stroke="#000" stroke-opacity="0.18" stroke-width="0.6">` +
      `${escapeXml(text)}</text></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  }, [text])

  return (
    <div
      aria-hidden
      data-testid="share-watermark"
      className="pointer-events-none absolute inset-0 z-10 select-none"
      style={{ backgroundImage }}
    />
  )
}
