export type Artifact = {
  id: string
  kind: 'html' | 'svg' | 'markdown'
  title: string
  code: string
}

const FENCE_RE = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
const MIN_ARTIFACT_CHARS = 120

function kindFor(lang: string, code: string): Artifact['kind'] | null {
  const normalized = lang.toLowerCase()
  if (normalized === 'html') return 'html'
  if (normalized === 'svg') return 'svg'
  if (normalized === 'markdown' || normalized === 'md') return 'markdown'
  if (!normalized) {
    const head = code.trimStart().slice(0, 200).toLowerCase()
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html'
    if (head.startsWith('<svg')) return 'svg'
  }
  return null
}

function titleFor(kind: Artifact['kind'], code: string, index: number): string {
  const titleTag = code.match(/<title>([^<]{1,80})<\/title>/i)?.[1]?.trim()
  if (titleTag) return titleTag
  const heading = code.match(/^#{1,3}\s+(.{1,80})$/m)?.[1]?.trim()
  if (kind === 'markdown' && heading) return heading
  const label = kind === 'html' ? 'HTML page' : kind === 'svg' ? 'SVG graphic' : 'Document'
  return index > 0 ? `${label} ${index + 1}` : label
}

export function extractArtifacts(messageId: string, content: string): Artifact[] {
  const artifacts: Artifact[] = []
  let match: RegExpExecArray | null
  FENCE_RE.lastIndex = 0
  while ((match = FENCE_RE.exec(content)) !== null) {
    const [, lang, code] = match
    const trimmed = code.trim()
    if (trimmed.length < MIN_ARTIFACT_CHARS) continue
    const kind = kindFor(lang, trimmed)
    if (!kind) continue
    artifacts.push({
      id: `${messageId}-artifact-${artifacts.length}`,
      kind,
      title: titleFor(kind, trimmed, artifacts.length),
      code: trimmed,
    })
  }
  return artifacts
}

export function artifactSrcDoc(artifact: Artifact): string {
  if (artifact.kind === 'html') {
    const head = artifact.code.trimStart().slice(0, 200).toLowerCase()
    if (head.startsWith('<!doctype') || head.startsWith('<html')) return artifact.code
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${artifact.code}</body></html>`
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#fff}svg{max-width:96vw;max-height:96vh}</style></head><body>${artifact.code}</body></html>`
}
