import { promises as fs } from 'node:fs'
import path from 'node:path'

export type ExtractedFile = {
  name: string
  path: string
  chars: number
  tokenEstimate: number
  text: string
  truncated: boolean
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_CHARS = 200_000
const MAX_PDF_PAGES = 300

export const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.xml',
  '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.sh', '.zsh', '.sql', '.log',
])

export function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.pdf' || TEXT_EXTENSIONS.has(ext)
}

async function extractPdfText(filePath: string): Promise<string> {

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(filePath))
  const task = getDocument({ data, useSystemFonts: true })
  const doc = await task.promise
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES)
    const parts: string[] = []
    for (let pageNum = 1; pageNum <= pages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) parts.push(text)
    }
    return parts.join('\n\n')
  } finally {
    await task.destroy()
  }
}

export async function extractFile(filePath: string): Promise<ExtractedFile> {
  const resolved = path.resolve(filePath)
  const ext = path.extname(resolved).toLowerCase()
  if (!isSupportedFile(resolved)) {
    throw new Error(`Unsupported file type: ${ext || 'no extension'}. Text, code, markdown and PDF files work.`)
  }
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('Not a file.')

  let text: string
  if (ext === '.pdf') {
    text = await extractPdfText(resolved)
    if (!text.trim()) {
      throw new Error('No extractable text in this PDF — it may be a scan without OCR.')
    }
  } else {
    if (stat.size > MAX_TEXT_BYTES) {
      throw new Error(`File is too large (${(stat.size / 1e6).toFixed(1)} MB). The limit is 2 MB of text.`)
    }
    text = await fs.readFile(resolved, 'utf8')
  }

  const truncated = text.length > MAX_CHARS
  if (truncated) text = text.slice(0, MAX_CHARS)
  return {
    name: path.basename(resolved),
    path: resolved,
    chars: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
    text,
    truncated,
  }
}
