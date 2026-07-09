import type { ReactNode } from 'react'
import { CopyButton } from './ui'

const INLINE = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\(([^)\s]+)\))/g

function safeHref(raw: string): string | null {
  try {
    const protocol = new URL(raw, 'https://invalid.local').protocol
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:' ? raw : null
  } catch {
    return null
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []

  const codeSplit = text.split(/(`[^`]+`)/g)
  codeSplit.forEach((segment, segmentIndex) => {
    if (segment.startsWith('`') && segment.endsWith('`') && segment.length > 1) {
      nodes.push(
        <code className="inline-code" key={`${keyPrefix}-c${segmentIndex}`}>
          {segment.slice(1, -1)}
        </code>,
      )
      return
    }
    let lastIndex = 0
    let match: RegExpExecArray | null
    INLINE.lastIndex = 0
    let markIndex = 0
    while ((match = INLINE.exec(segment)) !== null) {
      if (match.index > lastIndex) nodes.push(segment.slice(lastIndex, match.index))
      const key = `${keyPrefix}-${segmentIndex}-m${markIndex++}`
      if (match[2] !== undefined) nodes.push(<strong key={key}>{match[2]}</strong>)
      else if (match[3] !== undefined) nodes.push(<em key={key}>{match[3]}</em>)
      else if (match[4] !== undefined) nodes.push(<em key={key}>{match[4]}</em>)
      else if (match[5] !== undefined) {
        const href = safeHref(match[6])
        nodes.push(
          href ? (
            <a href={href} key={key} rel="noreferrer noopener" target="_blank">
              {match[5]}
            </a>
          ) : (
            match[5]
          ),
        )
      }
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < segment.length) nodes.push(segment.slice(lastIndex))
  })
  return nodes
}

type Block =
  | { type: 'code'; lang: string; content: string }
  | { type: 'text'; content: string }

function splitBlocks(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let buffer: string[] = []
  let inCode = false
  let codeLang = ''
  let codeBuffer: string[] = []

  const flushText = () => {
    if (buffer.length) {
      blocks.push({ type: 'text', content: buffer.join('\n') })
      buffer = []
    }
  }

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/)
    if (fence) {
      if (inCode) {
        blocks.push({ type: 'code', lang: codeLang, content: codeBuffer.join('\n') })
        codeBuffer = []
        inCode = false
      } else {
        flushText()
        inCode = true
        codeLang = fence[1].trim()
      }
      continue
    }
    if (inCode) codeBuffer.push(line)
    else buffer.push(line)
  }
  if (inCode) blocks.push({ type: 'code', lang: codeLang, content: codeBuffer.join('\n') })
  flushText()
  return blocks
}

function renderTextBlock(content: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = content.split('\n')
  let listItems: { ordered: boolean; text: string }[] = []
  let paragraph: string[] = []
  let blockKey = 0

  const flushParagraph = () => {
    if (paragraph.length) {
      const text = paragraph.join('\n')
      out.push(<p key={`${key}-p${blockKey++}`}>{renderInline(text, `${key}-p${blockKey}`)}</p>)
      paragraph = []
    }
  }
  const flushList = () => {
    if (listItems.length) {
      const ordered = listItems[0].ordered
      const items = listItems.map((item, index) => (
        <li key={`${key}-li${index}`}>{renderInline(item.text, `${key}-li${index}`)}</li>
      ))
      out.push(ordered ? <ol key={`${key}-l${blockKey++}`}>{items}</ol> : <ul key={`${key}-l${blockKey++}`}>{items}</ul>)
      listItems = []
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const Tag = (['h3', 'h3', 'h4', 'h5'] as const)[level - 1]
      out.push(<Tag key={`${key}-h${blockKey++}`}>{renderInline(heading[2], `${key}-h${blockKey}`)}</Tag>)
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      out.push(
        <blockquote key={`${key}-q${blockKey++}`}>{renderInline(quote[1], `${key}-q${blockKey}`)}</blockquote>,
      )
      continue
    }
    const ordered = line.match(/^\d+\.\s+(.*)$/)
    const unordered = line.match(/^[-*]\s+(.*)$/)
    if (ordered || unordered) {
      flushParagraph()
      listItems.push({ ordered: Boolean(ordered), text: (ordered ? ordered[1] : unordered![1]) })
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return out
}

export function Markdown({ source }: { source: string }) {
  const blocks = splitBlocks(source)
  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <div className="code-block" key={`block-${index}`}>
              <div className="code-block-head">
                <span>{block.lang || 'code'}</span>
                <CopyButton text={block.content} />
              </div>
              <pre>
                <code>{block.content}</code>
              </pre>
            </div>
          )
        }
        return <div key={`block-${index}`}>{renderTextBlock(block.content, `block-${index}`)}</div>
      })}
    </div>
  )
}
