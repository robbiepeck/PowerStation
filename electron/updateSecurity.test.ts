import { describe, expect, it } from 'vitest'
import { isSafeZipEntry, parseTeamIdentifier } from './updateSecurity.js'

describe('macOS update signing identity', () => {
  it('extracts a valid Apple Team Identifier', () => {
    expect(parseTeamIdentifier('Authority=Developer ID Application: Example\nTeamIdentifier=ABC123XYZ9\n')).toBe(
      'ABC123XYZ9',
    )
  })

  it('rejects ad-hoc and malformed identities', () => {
    expect(parseTeamIdentifier('Signature=adhoc\nTeamIdentifier=not set\n')).toBeNull()
    expect(parseTeamIdentifier('TeamIdentifier=../../wrong')).toBeNull()
    expect(parseTeamIdentifier('Authority=none')).toBeNull()
  })
})

describe('macOS update archive entries', () => {
  it('accepts ordinary app-bundle entries', () => {
    expect(isSafeZipEntry('PowerStation.app/Contents/MacOS/PowerStation')).toBe(true)
    expect(isSafeZipEntry('./PowerStation.app/Contents/Info.plist')).toBe(true)
  })

  it('rejects absolute and parent-traversal paths on Unix and Windows', () => {
    expect(isSafeZipEntry('/tmp/evil')).toBe(false)
    expect(isSafeZipEntry('../evil')).toBe(false)
    expect(isSafeZipEntry('PowerStation.app/../../evil')).toBe(false)
    expect(isSafeZipEntry('..\\evil')).toBe(false)
    expect(isSafeZipEntry('C:\\Windows\\evil')).toBe(false)
  })
})
