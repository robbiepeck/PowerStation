import { describe, expect, it } from 'vitest'
import { buildBackupJson, parseBackupJson, BACKUP_FORMAT, BACKUP_VERSION } from './backupFormat.js'

const PARTS = {
  appVersion: '0.11.0',
  state: { settings: { temperature: 0.7 } },
  skills: [{ slug: 'sql-helper', content: '---\nname: SQL helper\n---\nbody' }],
  chats: [{ id: 'chat-1-2', messages: [] }],
  projects: [{ id: 'proj-1-2', name: 'Docs' }],
}

describe('backup format', () => {
  it('round-trips', () => {
    const archive = parseBackupJson(buildBackupJson(PARTS))
    expect(archive.format).toBe(BACKUP_FORMAT)
    expect(archive.version).toBe(BACKUP_VERSION)
    expect(archive.appVersion).toBe('0.11.0')
    expect(archive.skills).toEqual(PARTS.skills)
    expect(archive.chats).toHaveLength(1)
    expect(archive.projects).toHaveLength(1)
    expect(archive.state).toEqual(PARTS.state)
  })

  it('rejects non-backups with readable messages', () => {
    expect(() => parseBackupJson('')).toThrow('empty')
    expect(() => parseBackupJson('{not json')).toThrow('not valid JSON')
    expect(() => parseBackupJson('{"format":"other"}')).toThrow('not a PowerStation backup')
    expect(() => parseBackupJson(JSON.stringify({ format: BACKUP_FORMAT, version: 99 }))).toThrow('version 99')
  })

  it('drops malformed skills but keeps the rest of the archive', () => {
    const raw = JSON.parse(buildBackupJson(PARTS)) as Record<string, unknown>
    raw.skills = [
      { slug: 'ok-skill', content: 'x' },
      { slug: 'BAD SLUG', content: 'x' },
      { slug: 'no-content' },
      'not-an-object',
    ]
    const archive = parseBackupJson(JSON.stringify(raw))
    expect(archive.skills).toEqual([{ slug: 'ok-skill', content: 'x' }])
    expect(archive.chats).toHaveLength(1)
  })
})
