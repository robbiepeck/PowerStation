import { describe, expect, it } from 'vitest'
import { composeSystemPrompt, parseSkillFile, serializeSkillFile, skillMatchesMessage, slugifySkillName } from './skillFormat.js'

describe('parseSkillFile', () => {
  it('reads frontmatter name, description and body', () => {
    const parsed = parseSkillFile('---\nname: Code reviewer\ndescription: Reviews code.\ntriggers: review, refactor\n---\n\nBe thorough.\n', 'fallback')
    expect(parsed.name).toBe('Code reviewer')
    expect(parsed.description).toBe('Reviews code.')
    expect(parsed.body).toBe('Be thorough.')
    expect(parsed.triggers).toEqual(['review', 'refactor'])
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
    const skill = { name: 'Tutor', description: 'Teaches step by step.', body: 'One concept at a time.', triggers: ['teach'] }
    expect(parseSkillFile(serializeSkillFile(skill), 'x')).toEqual(skill)
  })
})

describe('composeSystemPrompt', () => {
  it('joins the base prompt and enabled skills under headings', () => {
    const composed = composeSystemPrompt('You are helpful.', [
      { name: 'Concise', description: '', body: 'Be brief.', triggers: [] },
      { name: 'Empty', description: '', body: '', triggers: [] },
    ])
    expect(composed).toBe('You are helpful.\n\n## Skill: Concise\nBe brief.')
  })

  it('returns an empty string when nothing is configured', () => {
    expect(composeSystemPrompt('  ', [])).toBe('')
  })
})

describe('skillMatchesMessage', () => {
  const base = { description: '', body: 'x' }
  it('matches any trigger phrase, case-insensitively', () => {
    const skill = { ...base, name: 'Meeting notes', triggers: ['meeting', 'action items'] }
    expect(skillMatchesMessage(skill, 'Here are my MEETING notes from today')).toBe(true)
    expect(skillMatchesMessage(skill, 'please extract the action items')).toBe(true)
    expect(skillMatchesMessage(skill, 'write a poem')).toBe(false)
  })
  it('falls back to name words when no triggers are set', () => {
    const skill = { ...base, name: 'Code reviewer', triggers: [] }
    expect(skillMatchesMessage(skill, 'can you review this code?')).toBe(true)
    expect(skillMatchesMessage(skill, 'dinner ideas please')).toBe(false)
  })
})

describe('slugifySkillName', () => {
  it('produces filesystem-safe slugs', () => {
    expect(slugifySkillName('Meeting Notes → Actions!')).toBe('meeting-notes-actions')
    expect(slugifySkillName('***')).toBe('skill')
  })
})
