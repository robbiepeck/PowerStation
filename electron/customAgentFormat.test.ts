import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_EMOJI, isValidAgentId, sanitizeCustomAgent } from './customAgentFormat.js'

const ID = 'agent-1751500000000-123456'
const FOLDER = { folderId: 'a'.repeat(16), folder: '/Users/robbie/docs', name: 'docs' }

describe('sanitizeCustomAgent', () => {
  it('keeps a well-formed agent intact', () => {
    const agent = sanitizeCustomAgent(
      {
        name: '  Docs   Bot ',
        emoji: '📚',
        description: 'Answers from the docs.',
        instructions: 'Cite your sources.',
        knowledge: [FOLDER, { folderId: 'b'.repeat(16), folder: '/x', name: 'x' }],
        createdAt: 5,
      },
      ID,
    )
    expect(agent?.name).toBe('Docs Bot')
    expect(agent?.emoji).toBe('📚')
    expect(agent?.knowledge).toHaveLength(2)
    expect(agent?.createdAt).toBe(5)
  })

  it('rejects missing names and bad ids', () => {
    expect(sanitizeCustomAgent({ name: ' ' }, ID)).toBeNull()
    expect(sanitizeCustomAgent({ name: 'ok' }, 'proj-123456')).toBeNull()
    expect(isValidAgentId('agent-abc-123')).toBe(true)
    expect(isValidAgentId('agent-ABC')).toBe(false)
  })

  it('defaults the emoji and caps it to a face, not a sentence', () => {
    expect(sanitizeCustomAgent({ name: 'X' }, ID)?.emoji).toBe(DEFAULT_AGENT_EMOJI)
    expect(sanitizeCustomAgent({ name: 'X', emoji: 'ABCDEFG' }, ID)?.emoji).toBe('ABCD')
  })

  it('drops malformed and duplicate knowledge folders, capped at 8', () => {
    const agent = sanitizeCustomAgent(
      {
        name: 'X',
        knowledge: [
          FOLDER,
          FOLDER, // duplicate folderId
          { folderId: 'not-hex', folder: '/y', name: 'y' },
          ...Array.from({ length: 12 }, (_, i) => ({
            folderId: `${i}`.repeat(16).slice(0, 15) + 'f',
            folder: `/f${i}`,
            name: `f${i}`,
          })),
        ],
      },
      ID,
    )
    expect(agent?.knowledge.length).toBeLessThanOrEqual(8)
    expect(agent?.knowledge.filter((k) => k.folderId === FOLDER.folderId)).toHaveLength(1)
  })

  it('caps oversized instructions', () => {
    expect(sanitizeCustomAgent({ name: 'X', instructions: 'a'.repeat(10_000) }, ID)?.instructions.length).toBe(8_000)
  })
})
