import React from 'react'

export function parseSimpleMarkdown(text: string): (string | { type: string; content: string })[] {
  const parts: (string | { type: string; content: string })[] = []

  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g
  let lastIndex = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[1]) {
      parts.push({ type: 'bold', content: match[1] })
    } else if (match[2]) {
      parts.push({ type: 'italic', content: match[2] })
    } else if (match[3]) {
      parts.push({ type: 'code', content: match[3] })
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length === 0 ? [text] : parts
}

export function renderMarkdown(
  parts: (string | { type: string; content: string })[],
  mine: boolean,
  portal: boolean
): React.ReactNode {
  return parts.map((part, i) => {
    if (typeof part === 'string') {
      return part
    }

    const className = mine
      ? 'text-black'
      : portal
        ? 'text-w-ink'
        : 'text-gray-900'

    if (part.type === 'bold') {
      return React.createElement('strong', { key: i, className }, part.content)
    } else if (part.type === 'italic') {
      return React.createElement('em', { key: i, className }, part.content)
    } else if (part.type === 'code') {
      const codeBg = mine ? 'bg-black/20' : portal ? 'bg-w-panel2' : 'bg-gray-100'
      return React.createElement(
        'code',
        {
          key: i,
          className: `px-1 py-0.5 rounded text-xs font-mono ${codeBg}`,
        },
        part.content
      )
    }

    return part.content
  })
}
