import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isStableReleaseTag,
  nodeMajor,
  selectInstallDirectory,
} from './source-install-lib.mjs'

describe('source install helpers', () => {
  it('accepts stable source-release tags only', () => {
    expect(isStableReleaseTag('v0.18.1')).toBe(true)
    expect(isStableReleaseTag('0.18.1')).toBe(false)
    expect(isStableReleaseTag('v0.18.1-beta.1')).toBe(false)
  })

  it('compares semantic release versions', () => {
    expect(compareVersions('v0.18.1', '0.18.0')).toBeGreaterThan(0)
    expect(compareVersions('0.18.1', 'v0.18.1')).toBe(0)
  })

  it('extracts the Node major version', () => {
    expect(nodeMajor('v22.14.0')).toBe(22)
    expect(nodeMajor('not-node')).toBe(0)
  })

  it('prefers an explicitly selected installation directory', () => {
    expect(
      selectInstallDirectory({
        override: '/tmp/apps',
        home: '/Users/test',
        systemAppExists: true,
        systemDirectoryWritable: true,
        userAppExists: true,
      }),
    ).toBe('/tmp/apps')
  })

  it('updates a writable existing system installation, otherwise uses the user Applications folder', () => {
    expect(
      selectInstallDirectory({
        home: '/Users/test',
        systemAppExists: true,
        systemDirectoryWritable: true,
        userAppExists: false,
      }),
    ).toBe('/Applications')
    expect(
      selectInstallDirectory({
        home: '/Users/test',
        systemAppExists: true,
        systemDirectoryWritable: false,
        userAppExists: false,
      }),
    ).toBe('/Users/test/Applications')
  })
})
