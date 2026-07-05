import { describe, expect, it } from 'vitest'
import { artifactSrcDoc, extractArtifacts } from './artifacts.js'

const HTML = `<!doctype html>\n<html><head><title>Demo page</title></head><body><h1>Hello</h1><p>${'x'.repeat(80)}</p></body></html>`

describe('extractArtifacts', () => {
  it('finds an html fence and uses its <title>', () => {
    const artifacts = extractArtifacts('m1', 'Here you go:\n\n```html\n' + HTML + '\n```\nEnjoy!')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ kind: 'html', title: 'Demo page' })
  })

  it('detects doctype in unlabelled fences', () => {
    const artifacts = extractArtifacts('m2', '```\n' + HTML + '\n```')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].kind).toBe('html')
  })

  it('ignores small snippets and non-artifact languages', () => {
    expect(extractArtifacts('m3', '```html\n<b>hi</b>\n```')).toHaveLength(0)
    expect(extractArtifacts('m4', '```python\n' + 'print(1)\n'.repeat(30) + '```')).toHaveLength(0)
  })

  it('titles markdown artifacts from their first heading', () => {
    const md = '# Quarterly report\n\n' + 'Lots of content here. '.repeat(20)
    const artifacts = extractArtifacts('m5', '```markdown\n' + md + '\n```')
    expect(artifacts[0]).toMatchObject({ kind: 'markdown', title: 'Quarterly report' })
  })

  it('extracts svg artifacts', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${'<circle cx="5" cy="5" r="2"/>'.repeat(10)}</svg>`
    const artifacts = extractArtifacts('m6', '```svg\n' + svg + '\n```')
    expect(artifacts[0].kind).toBe('svg')
  })
})

describe('artifactSrcDoc', () => {
  it('passes full html documents through unchanged', () => {
    expect(artifactSrcDoc({ id: 'a', kind: 'html', title: 't', code: HTML })).toBe(HTML)
  })

  it('wraps fragments in a document shell', () => {
    const doc = artifactSrcDoc({ id: 'a', kind: 'html', title: 't', code: '<h1>Hi</h1>' })
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('<h1>Hi</h1>')
  })
})
