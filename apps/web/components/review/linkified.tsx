import * as React from 'react'

const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g

/** Renders plain text with URLs turned into clickable links. */
export function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of Array.from(text.matchAll(URL_RE))) {
    const idx = match.index ?? 0
    if (idx > last) parts.push(text.slice(last, idx))
    parts.push(
      <a
        key={idx}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2 hover:text-accent/80 break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {match[0]}
      </a>,
    )
    last = idx + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
