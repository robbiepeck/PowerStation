import { describe, expect, it } from 'vitest'
import { isTrustedApiBrowserRequest, isTrustedApiHostHeader, trustedApiOrigin } from './apiSecurity.js'

describe('local API request boundaries', () => {
  it('accepts only loopback Host headers', () => {
    expect(isTrustedApiHostHeader('127.0.0.1:4141')).toBe(true)
    expect(isTrustedApiHostHeader('localhost:65535')).toBe(true)
    expect(isTrustedApiHostHeader('[::1]:4141')).toBe(true)
    expect(isTrustedApiHostHeader('attacker.example')).toBe(false)
    expect(isTrustedApiHostHeader('localhost.attacker.example')).toBe(false)
    expect(isTrustedApiHostHeader('user@localhost:4141')).toBe(false)
  })

  it('allows browser access only from loopback origins', () => {
    expect(trustedApiOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(trustedApiOrigin('https://localhost:8443')).toBe('https://localhost:8443')
    expect(trustedApiOrigin('http://[::1]:5173')).toBe('http://[::1]:5173')
    expect(trustedApiOrigin('https://attacker.example')).toBeNull()
    expect(trustedApiOrigin('null')).toBeNull()
    expect(isTrustedApiBrowserRequest(undefined)).toBe(true)
    expect(isTrustedApiBrowserRequest('https://attacker.example')).toBe(false)
  })
})
