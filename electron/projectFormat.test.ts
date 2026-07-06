import { describe, expect, it } from 'vitest'
import { isValidProjectId, sanitizeProject } from './projectFormat.js'

const ID = 'proj-1751500000000-123456'

describe('sanitizeProject', () => {
  it('keeps a well-formed project intact', () => {
    const project = sanitizeProject(
      {
        name: '  Client   Docs ',
        instructions: 'Always answer in plain English.',
        modelPath: '/models/gemma.gguf',
        knowledge: { folderId: 'a'.repeat(16), folder: '/Users/robbie/docs', name: 'docs' },
        skillModes: { 'sql-helper': 'always', 'regex-helper': 'off' },
        mcpServerIds: ['mcp-1', 'mcp-2', 'mcp-1'],
        createdAt: 5,
        updatedAt: 6,
      },
      ID,
    )
    expect(project?.name).toBe('Client Docs')
    expect(project?.knowledge?.folderId).toBe('a'.repeat(16))
    expect(project?.skillModes).toEqual({ 'sql-helper': 'always', 'regex-helper': 'off' })
    expect(project?.mcpServerIds).toEqual(['mcp-1', 'mcp-2'])
    expect(project?.createdAt).toBe(5)
  })

  it('rejects a missing name and bad ids', () => {
    expect(sanitizeProject({ name: '   ' }, ID)).toBeNull()
    expect(sanitizeProject({ name: 'ok' }, 'chat-123456')).toBeNull()
    expect(isValidProjectId('proj-abc-123')).toBe(true)
    expect(isValidProjectId('proj-ABC')).toBe(false)
  })

  it('drops malformed knowledge, modes, and server ids instead of failing', () => {
    const project = sanitizeProject(
      {
        name: 'X',
        knowledge: { folderId: 'not-hex', folder: '/x', name: 'x' },
        skillModes: { 'BAD SLUG': 'always', good: 'sometimes', kept: 'auto' },
        mcpServerIds: ['ok', 42, null],
      },
      ID,
    )
    expect(project?.knowledge).toBeNull()
    expect(project?.skillModes).toEqual({ kept: 'auto' })
    expect(project?.mcpServerIds).toEqual(['ok'])
  })

  it('caps oversized instructions', () => {
    const project = sanitizeProject({ name: 'X', instructions: 'a'.repeat(10_000) }, ID)
    expect(project?.instructions.length).toBe(8_000)
  })
})
