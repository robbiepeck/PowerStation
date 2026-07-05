import { describe, expect, it } from 'vitest'
import { composeSystemPrompt, parseSkillFile, serializeSkillFile, slugifySkillName } from './skillFormat.js'

describe('parseSkillFile', () => {
  it('reads frontmatter name, description and body', () => {
    const parsed = parseSkillFile('---\nname: Code reviewer\ndescription: Reviews code.\n---\n\nBe thorough.\n', 'fallback')
    expect(parsed.name).toBe('Code reviewer')
    expect(parsed.description).toBe('Reviews code.')
    expect(parsed.body).toBe('Be thorough.')
  })

  it('falls back to the file name when frontmatter is missing', () => {
    const parsed = parseSkillFile('Just instructions, no frontmatter.', 'my-skill')
    expect(parsed.name).toBe('my-skill')
    expect(parsed.description).toBe('')
    expect(parsed.body).toBe('Just instructions, no frontmatter.')
  })

  it('handles CRLF files', () => {
    const parsed = parseSkillFile('---\r\nname: Windows skill\r\n---\r\nBody here.\r\n', 'x')
    expect(parsed.name).toBe('Windows skill')
    expect(parsed.body).toBe('Body here.')
  })

  it('round-trips through serialize', () => {
    const skill = { name: 'Tutor', description: 'Teaches step by step.', body: 'One concept at a time.' }
    expect(parseSkillFile(serializeSkillFile(skill), 'x')).toEqual(skill)
  })
})

describe('composeSystemPrompt', () => {
  it('joins the base prompt and enabled skills under headings', () => {
    const composed = composeSystemPrompt('You are helpful.', [
      { name: 'Concise', description: '', body: 'Be brief.' },
      { name: 'Empty', description: '', body: '' },
    ])
    expect(composed).toBe('You are helpful.\n\n## Skill: Concise\nBe brief.')
  })

  it('returns an empty string when nothing is configured', () => {
    expect(composeSystemPrompt('  ', [])).toBe('')
  })
})

describe('slugifySkillName', () => {
  it('produces filesystem-safe slugs', () => {
    expect(slugifySkillName('Meeting Notes → Actions!')).toBe('meeting-notes-actions')
    expect(slugifySkillName('***')).toBe('skill')
  })
})
