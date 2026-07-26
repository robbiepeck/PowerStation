import { describe, expect, it } from 'vitest'
import { buildBackupJson, parseBackupJson, BACKUP_FORMAT, BACKUP_VERSION } from './backupFormat.js'

const PARTS = {
  appVersion: '0.11.0',
  state: {
    settings: {
      temperature: 0.7,
      utilities: { mcpServers: [{ id: 'local', command: 'danger', enabled: true }] },
    },
    modelFolders: ['/Users/robbie/models'],
    importedModelPaths: ['/Users/robbie/model.gguf'],
    selectedModelPath: '/Users/robbie/model.gguf',
    benchmarks: { '/Users/robbie/model.gguf': { tokensPerSec: 1 } },
    toolPermissions: { write_file: 'allow' },
    activeProjectId: 'proj-local',
    apiServer: { enabled: true, port: 4141, token: 'secret-local-token' },
  },
  skills: [{ slug: 'sql-helper', content: '---\nname: SQL helper\n---\nbody' }],
  chats: [{ id: 'chat-1-2', messages: [] }],
  projects: [
    {
      id: 'proj-1-2',
      name: 'Docs',
      modelPath: '/private/model.gguf',
      knowledge: { folderId: 'a'.repeat(16), folder: '/private/docs', name: 'Docs' },
      mcpServerIds: ['local'],
    },
  ],
  agents: [
    {
      id: 'agent-1-2',
      name: 'Agent',
      knowledge: [{ folderId: 'a'.repeat(16), folder: '/private/docs', name: 'Docs' }],
      mcpServerIds: ['local'],
    },
  ],
  schedules: [
    {
      id: 'schedule-12345678',
      name: 'Morning brief',
      enabled: true,
      modelPath: '/Users/robbie/private/model.gguf',
      nextRunAt: 123,
    },
  ],
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
    expect(archive.schedules).toHaveLength(1)
    expect(archive.schedules[0]).toMatchObject({
      enabled: false,
      modelPath: 'model.gguf',
      nextRunAt: null,
    })
    expect(archive.state).toMatchObject({
      modelFolders: [],
      importedModelPaths: [],
      selectedModelPath: null,
      benchmarks: {},
      toolPermissions: {},
      activeProjectId: null,
      apiServer: { enabled: false, port: 4141, token: '' },
    })
    expect(
      ((archive.state.settings as Record<string, unknown>).utilities as Record<string, unknown>).mcpServers,
    ).toEqual([{ id: 'local', command: 'danger', enabled: false }])
    expect(archive.projects[0]).toMatchObject({ modelPath: null, knowledge: null, mcpServerIds: [] })
    expect(archive.agents[0]).toMatchObject({ knowledge: [], mcpServerIds: [] })
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

  it('strips local authority from older or hand-edited backups during import', () => {
    const raw = JSON.parse(buildBackupJson(PARTS)) as Record<string, unknown>
    raw.state = PARTS.state
    raw.projects = PARTS.projects
    raw.agents = PARTS.agents
    raw.schedules = PARTS.schedules
    const archive = parseBackupJson(JSON.stringify(raw))
    expect(archive.state).toMatchObject({
      modelFolders: [],
      importedModelPaths: [],
      selectedModelPath: null,
      toolPermissions: {},
      activeProjectId: null,
      apiServer: { enabled: false, token: '' },
    })
    expect(archive.projects[0]).toMatchObject({ modelPath: null, knowledge: null, mcpServerIds: [] })
    expect(archive.agents[0]).toMatchObject({ knowledge: [], mcpServerIds: [] })
    expect(archive.schedules[0]).toMatchObject({ enabled: false, modelPath: 'model.gguf', nextRunAt: null })
  })
})
