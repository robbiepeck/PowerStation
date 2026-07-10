import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isAllowedModelUri,
  isPathInside,
  isTrustedExternalUrl,
  isTrustedRendererNavigation,
  trustedLoopbackDevUrl,
} from './security.js'

describe('external URL policy', () => {
  it('allows only the documented trusted HTTPS pages', () => {
    expect(isTrustedExternalUrl('https://huggingface.co/org/model')).toBe(true)
    expect(isTrustedExternalUrl('https://github.com/robbiepeck/PowerStation/releases/latest')).toBe(true)
    expect(isTrustedExternalUrl('https://github.com/robbiepeck/PowerStation-evil')).toBe(false)
    expect(isTrustedExternalUrl('http://huggingface.co/model')).toBe(false)
    expect(isTrustedExternalUrl('mailto:test@example.com')).toBe(false)
  })
})

describe('model download policy', () => {
  it('allows constrained Hugging Face shorthand and GGUF URLs', () => {
    expect(isAllowedModelUri('hf:user/repo:Q4_K_M')).toBe(true)
    expect(isAllowedModelUri('https://huggingface.co/user/repo/resolve/main/model.gguf')).toBe(true)
  })

  it('rejects arbitrary HTTPS, private-network, credential, and malformed inputs', () => {
    expect(isAllowedModelUri('https://example.com/model.gguf')).toBe(false)
    expect(isAllowedModelUri('https://127.0.0.1/model.gguf')).toBe(false)
    expect(isAllowedModelUri('https://user:pass@huggingface.co/u/r/resolve/main/model.gguf')).toBe(false)
    expect(isAllowedModelUri('hf:../../etc/passwd')).toBe(false)
  })
})

describe('renderer navigation policy', () => {
  const entry = pathToFileURL('/opt/PowerStation/dist/index.html').toString()

  it('allows the exact entry file and an in-page hash only', () => {
    expect(isTrustedRendererNavigation(entry, entry)).toBe(true)
    expect(isTrustedRendererNavigation(`${entry}#section`, entry)).toBe(true)
    expect(isTrustedRendererNavigation('file:///tmp/attacker.html', entry)).toBe(false)
  })

  it('allows only the packaged custom-protocol entry document', () => {
    const packaged = 'powerstation://app/index.html'
    expect(isTrustedRendererNavigation(packaged, packaged)).toBe(true)
    expect(isTrustedRendererNavigation(`${packaged}#section`, packaged)).toBe(true)
    expect(isTrustedRendererNavigation('powerstation://app/other.html', packaged)).toBe(false)
    expect(isTrustedRendererNavigation('powerstation://evil/index.html', packaged)).toBe(false)
  })

  it('allows only exact loopback dev origins', () => {
    expect(trustedLoopbackDevUrl('http://127.0.0.1:5173')).not.toBeNull()
    expect(trustedLoopbackDevUrl('https://example.com')).toBeNull()
    expect(isTrustedRendererNavigation('http://127.0.0.1:5173/page', entry, 'http://127.0.0.1:5173')).toBe(true)
    expect(isTrustedRendererNavigation('http://127.0.0.1:51730/page', entry, 'http://127.0.0.1:5173')).toBe(false)
  })
})

describe('path containment', () => {
  it('uses a path boundary instead of a string prefix', () => {
    expect(isPathInside('/safe/root', '/safe/root/file.txt')).toBe(true)
    expect(isPathInside('/safe/root', '/safe/root-evil/file.txt')).toBe(false)
    expect(isPathInside('/safe/root', '/safe/root')).toBe(false)
    expect(isPathInside('/safe/root', '/safe/root', true)).toBe(true)
  })
})
