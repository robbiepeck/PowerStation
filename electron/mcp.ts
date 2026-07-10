import { app } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpServerConfig } from './config.js'
import { splitCommand } from './mcpCommand.js'

export type McpToolInfo = {

  key: string
  serverId: string
  serverName: string
  name: string
  description: string
  inputSchema: Record<string, unknown> | null
}

export type McpServerStatus = {
  id: string
  name: string
  state: 'connected' | 'connecting' | 'error' | 'disconnected'
  toolCount: number
  error: string | null
}

type Connection = {
  config: McpServerConfig
  client: Client
  tools: McpToolInfo[]
}

const connections = new Map<string, Connection>()
const statuses = new Map<string, McpServerStatus>()
let statusListener: ((statuses: McpServerStatus[]) => void) | null = null

export function onMcpStatusChange(listener: typeof statusListener): void {
  statusListener = listener
}

function publishStatus(): void {
  statusListener?.(getMcpStatuses())
}

export function getMcpStatuses(): McpServerStatus[] {
  return [...statuses.values()]
}

function setStatus(config: McpServerConfig, state: McpServerStatus['state'], error: string | null = null): void {
  statuses.set(config.id, {
    id: config.id,
    name: config.name,
    state,
    toolCount: connections.get(config.id)?.tools.length ?? 0,
    error: error?.slice(0, 500) ?? null,
  })
  publishStatus()
}

function toolKey(serverName: string, toolName: string): string {
  return `${serverName}:${toolName}`
}

const inFlightConnects = new Map<string, Promise<McpServerStatus>>()

export function connectServer(config: McpServerConfig): Promise<McpServerStatus> {
  const existing = inFlightConnects.get(config.id)
  if (existing) return existing
  const attempt = doConnectServer(config).finally(() => inFlightConnects.delete(config.id))
  inFlightConnects.set(config.id, attempt)
  return attempt
}

async function doConnectServer(config: McpServerConfig): Promise<McpServerStatus> {
  await disconnectServer(config.id)
  setStatus(config, 'connecting')

  const [command, ...args] = splitCommand(config.command)
  if (!command) {
    setStatus(config, 'error', 'Empty command')
    return statuses.get(config.id)!
  }

  try {
    const client = new Client({ name: 'PowerStation', version: '0.1.0' })
    const transport = new StdioClientTransport({
      command,
      args,

      env: getDefaultEnvironment(),

      cwd: app.getPath('userData'),
      stderr: 'pipe',
    })
    await client.connect(transport)

    const { tools } = await client.listTools()
    const mapped: McpToolInfo[] = tools.map((tool) => ({
      key: toolKey(config.name, tool.name),
      serverId: config.id,
      serverName: config.name,
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? null,
    }))

    connections.set(config.id, { config, client, tools: mapped })
    client.onclose = () => {
      if (connections.get(config.id)?.client === client) {
        connections.delete(config.id)
        setStatus(config, 'disconnected', 'Server process exited')
      }
    }
    setStatus(config, 'connected')
  } catch (error) {
    connections.delete(config.id)
    setStatus(config, 'error', error instanceof Error ? error.message : String(error))
  }
  return statuses.get(config.id)!
}

export async function disconnectServer(serverId: string): Promise<void> {
  const connection = connections.get(serverId)
  if (!connection) return
  connections.delete(serverId)
  try {
    await connection.client.close()
  } catch {
    void 0
  }
  setStatus(connection.config, 'disconnected')
}

export async function disconnectAll(): Promise<void> {
  await Promise.allSettled([...connections.keys()].map((id) => disconnectServer(id)))
}

export function getConnectedTools(): McpToolInfo[] {
  return [...connections.values()].flatMap((connection) => connection.tools)
}

export function findTool(key: string): McpToolInfo | null {
  return getConnectedTools().find((tool) => tool.key === key) ?? null
}

export function getServerConfig(serverId: string): McpServerConfig | null {
  return connections.get(serverId)?.config ?? null
}

export function getServerBaseDir(serverId: string): string | null {
  const connection = connections.get(serverId)
  if (!connection) return null
  const parts = splitCommand(connection.config.command)
  const last = parts[parts.length - 1]
  return last && (last.startsWith('/') || /^[A-Za-z]:[\\/]/.test(last)) ? last : null
}

export async function callTool(tool: McpToolInfo, args: unknown): Promise<{ ok: boolean; text: string }> {
  const connection = connections.get(tool.serverId)
  if (!connection) return { ok: false, text: `Server for ${tool.key} is not connected.` }

  try {
    const result = await connection.client.callTool(
      { name: tool.name, arguments: (args as Record<string, unknown>) ?? {} },
      undefined,
      { timeout: 60000, resetTimeoutOnProgress: true, maxTotalTimeout: 5 * 60000 },
    )
    const content = Array.isArray(result.content) ? result.content : []
    const text = content
      .map((item: { type?: string; text?: string }) => (item.type === 'text' && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, 20000)
    if (result.isError) return { ok: false, text: text || 'Tool reported an error.' }
    return { ok: true, text: text || '(tool returned no text output)' }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) }
  }
}
