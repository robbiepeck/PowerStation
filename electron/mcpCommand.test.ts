import { describe, expect, it } from 'vitest'
import { quoteCommandArg, splitCommand } from './mcpCommand.js'

describe('MCP command parsing', () => {
  it('preserves quoted paths and escaped quotes without using a shell', () => {
    expect(splitCommand('npx -y pkg "/Users/A Folder/file"')).toEqual([
      'npx',
      '-y',
      'pkg',
      '/Users/A Folder/file',
    ])
    const awkward = '/tmp/a "quoted" folder\\name'
    expect(splitCommand(`cmd ${quoteCommandArg(awkward)}`)).toEqual(['cmd', awkward])
  })

  it('rejects unterminated input rather than silently changing arguments', () => {
    expect(() => splitCommand('cmd "unfinished')).toThrow(/unterminated/)
    expect(splitCommand('cmd C:\\Models\\file.gguf')).toEqual(['cmd', 'C:\\Models\\file.gguf'])
  })

  it('treats shell metacharacters as plain arguments', () => {
    expect(splitCommand('tool ; rm -rf /')).toEqual(['tool', ';', 'rm', '-rf', '/'])
  })
})
