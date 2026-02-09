'use client'

import type { ReactNode } from 'react'

type Block =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language?: string }

const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\)/g
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function getSafeMarkdownHref(rawHref: string): string | null {
  const href = rawHref.trim()
  if (!href) {
    return null
  }

  if (!SCHEME_PATTERN.test(href)) {
    return null
  }

  try {
    const parsed = new URL(href)
    if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) {
      return null
    }
    return href
  } catch {
    return null
  }
}

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = []
  const regex = /```(\w+)?\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index)
      if (text) {
        blocks.push({ type: 'text', content: text })
      }
    }

    blocks.push({
      type: 'code',
      content: match[2] ?? '',
      language: match[1] ?? undefined,
    })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex)
    if (text) {
      blocks.push({ type: 'text', content: text })
    }
  }

  return blocks
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let partIndex = 0

  INLINE_PATTERN.lastIndex = 0

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const key = `${keyPrefix}-${partIndex}`
    partIndex += 1

    if (match[1]) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-700"
        >
          {match[1]}
        </code>
      )
    } else if (match[2] || match[3]) {
      nodes.push(
        <strong key={key}>{match[2] || match[3]}</strong>
      )
    } else if (match[4] || match[5]) {
      nodes.push(
        <em key={key}>{match[4] || match[5]}</em>
      )
    } else if (match[6] && match[7]) {
      const safeHref = getSafeMarkdownHref(match[7])
      if (!safeHref) {
        nodes.push(match[6])
      } else {
        nodes.push(
          <a
            key={key}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-azure underline"
          >
            {match[6]}
          </a>
        )
      }
    }

    lastIndex = INLINE_PATTERN.lastIndex
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function renderTextBlocks(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const lines = text.split(/\n/)
  let paragraphLines: string[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return
    }
    const paragraphText = paragraphLines.join(' ').trim()
    paragraphLines = []
    if (!paragraphText) {
      return
    }
    const key = `${keyPrefix}-p-${nodes.length}`
    nodes.push(
      <p key={key} className="text-sm leading-relaxed">
        {renderInline(paragraphText, key)}
      </p>
    )
  }

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      return
    }

    const listKey = `${keyPrefix}-l-${nodes.length}`
    const listClass =
      listType === 'ul'
        ? 'list-disc list-inside'
        : 'list-decimal list-inside'
    const ListTag = listType === 'ul' ? 'ul' : 'ol'

    nodes.push(
      <ListTag key={listKey} className={`${listClass} space-y-1 text-sm leading-relaxed`}>
        {listItems.map((item, index) => (
          <li key={`${listKey}-i-${index}`}>{renderInline(item, `${listKey}-i-${index}`)}</li>
        ))}
      </ListTag>
    )

    listItems = []
    listType = null
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.*)$/)
    if (unorderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ul') {
        flushList()
      }
      listType = 'ul'
      listItems.push(unorderedMatch[1])
      continue
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/)
    if (orderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ol') {
        flushList()
      }
      listType = 'ol'
      listItems.push(orderedMatch[1])
      continue
    }

    if (listType && listItems.length > 0) {
      listItems[listItems.length - 1] = `${listItems[listItems.length - 1]} ${trimmed}`
    } else {
      paragraphLines.push(trimmed)
    }
  }

  flushParagraph()
  flushList()

  return nodes
}

export default function MarkdownMessage({
  content,
  className = '',
}: {
  content: string
  className?: string
}) {
  const blocks = parseBlocks(content)

  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre
              key={`code-${index}`}
              className="rounded-lg bg-gray-900 text-gray-100 text-xs overflow-x-auto p-3"
            >
              <code className={block.language ? `language-${block.language}` : undefined}>
                {block.content}
              </code>
            </pre>
          )
        }

        return (
          <div key={`text-${index}`} className="space-y-2">
            {renderTextBlocks(block.content, `text-${index}`)}
          </div>
        )
      })}
    </div>
  )
}
