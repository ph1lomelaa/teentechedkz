// Mirrors backend/app/services/note_blocks.py:split_blocks — splits an AI
// summary_markdown string into the pre-heading intro ("hero") plus the
// #/##/### sections that follow, so the note detail views can render a
// short lead-in with the rest tucked into an accordion instead of dumping
// one long markdown blob.

export interface NoteBlock {
  heading: string
  content: string
}

const HEADING = /^(#{1,3})\s+(.*\S)\s*$/

export function splitNoteMarkdown(md: string | null | undefined): { hero: string; sections: NoteBlock[] } {
  if (!md) return { hero: '', sections: [] }

  let hero = ''
  const sections: NoteBlock[] = []
  let current: { heading: string; lines: string[] } | null = null

  const flush = () => {
    if (!current) return
    const content = current.lines.join('\n').trim()
    if (current.heading) {
      sections.push({ heading: current.heading, content })
    } else {
      hero = content
    }
  }

  for (const line of md.split('\n')) {
    const match = HEADING.exec(line)
    if (match) {
      flush()
      current = { heading: match[2].trim(), lines: [] }
    } else {
      if (!current) current = { heading: '', lines: [] }
      current.lines.push(line)
    }
  }
  flush()

  return { hero, sections }
}

export function countListItems(content: string): number | undefined {
  const count = content.split('\n').filter((line) => /^\s*[-*]\s+/.test(line)).length
  return count > 0 ? count : undefined
}
