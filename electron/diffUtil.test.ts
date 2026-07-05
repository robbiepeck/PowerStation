import { describe, expect, it } from 'vitest'
import { applyTextEdits, compactDiff, diffLines, previewDiff, summarizeDiff } from './diffUtil.js'

describe('diffLines', () => {
  it('marks identical text as all-same', () => {
    const diff = diffLines('a\nb', 'a\nb')
    expect(diff).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ])
  })

  it('detects a changed line as del+add', () => {
    const diff = diffLines('a\nb\nc', 'a\nX\nc')
    expect(diff).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'X' },
      { type: 'same', text: 'c' },
    ])
  })

  it('handles pure insertion and deletion', () => {
    expect(diffLines('', 'new').filter((l) => l.type === 'add')).toHaveLength(1)
    expect(diffLines('old', '').filter((l) => l.type === 'del')).toHaveLength(1)
  })

  it('handles CRLF input', () => {
    const diff = diffLines('a\r\nb', 'a\nb')
    expect(diff.every((l) => l.type === 'same')).toBe(true)
  })
})

describe('compactDiff', () => {
  it('collapses long unchanged runs and keeps context', () => {
    const same = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'same' as const, text: `line${i}` }))
    const lines = [...same(20), { type: 'add' as const, text: 'NEW' }, ...same(20).map((l) => ({ ...l, text: l.text + 'x' }))]
    const compact = compactDiff(lines)
    const skips = compact.filter((l) => l.type === 'skip')
    expect(skips).toHaveLength(2)
    expect(compact.filter((l) => l.type === 'same')).toHaveLength(6) // 3 context each side
    expect(compact.some((l) => l.text === 'NEW')).toBe(true)
  })
})

describe('summarize/preview', () => {
  it('counts adds and removes', () => {
    const { summary } = previewDiff('a\nb\nc', 'a\nB\nc\nd')
    expect(summary).toEqual({ added: 2, removed: 1 })
    expect(summarizeDiff([])).toEqual({ added: 0, removed: 0 })
  })
})

describe('applyTextEdits', () => {
  it('applies sequential first-occurrence replacements', () => {
    expect(
      applyTextEdits('hello world, hello moon', [
        { oldText: 'hello', newText: 'goodbye' },
        { oldText: 'moon', newText: 'sun' },
      ]),
    ).toBe('goodbye world, hello sun')
  })

  it('returns null when oldText is missing', () => {
    expect(applyTextEdits('abc', [{ oldText: 'zzz', newText: 'y' }])).toBeNull()
  })

  it('returns null on malformed edits', () => {
    expect(applyTextEdits('abc', [{ oldText: 'a' } as never])).toBeNull()
  })
})
