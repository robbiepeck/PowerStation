import { describe, expect, it } from 'vitest'
import { applicationName, buildProcessGroups, powerStationProcessIds, type BaseProcess } from './processTelemetry.js'

const processes: BaseProcess[] = [
  { pid: 10, parentPid: 1, name: 'PowerStation', cpu: 2, memRss: 200, command: 'PowerStation', path: '/Applications/PowerStation.app/Contents/MacOS/PowerStation' },
  { pid: 11, parentPid: 10, name: 'PowerStation Helper', cpu: 4, memRss: 300, command: 'PowerStation Helper', path: '/Applications/PowerStation.app/Contents/Frameworks/PowerStation Helper.app/Contents/MacOS/PowerStation Helper' },
  { pid: 20, parentPid: 1, name: 'Code Helper', cpu: 8, memRss: 400, command: 'Code Helper', path: '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper' },
]

describe('process telemetry grouping', () => {
  it('groups the app process and all descendants as PowerStation', () => {
    expect([...powerStationProcessIds(processes, 10)]).toEqual([10, 11])
    const groups = buildProcessGroups(processes, new Map([[10, 2], [11, 4], [20, 8]]), 100, 10)
    expect(groups.find((group) => group.id === 'powerstation')).toMatchObject({ name: 'PowerStation', value: 6 })
    expect(groups.find((group) => group.id === 'powerstation')?.processes).toHaveLength(2)
  })

  it('uses the outer macOS application bundle as the application name', () => {
    expect(applicationName(processes[2])).toBe('Visual Studio Code')
  })

  it('removes the Windows executable suffix', () => {
    expect(applicationName({ name: 'chrome.exe', command: '', path: 'C:\\Program Files\\Google\\Chrome\\chrome.exe' })).toBe('chrome')
  })
})
