import { describe, expect, it } from 'vitest'
import {
  chatChunk,
  chatCompletion,
  embeddingInputs,
  embeddingsResponse,
  modelsList,
  parseChatBody,
} from './apiFormat.js'

describe('parseChatBody', () => {
  it('splits system / history / final prompt', () => {
    const p = parseChatBody({
      model: 'gemma.gguf',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'What is 2+2?' },
      ],
      stream: true,
      temperature: 0.2,
    })
    expect(p.model).toBe('gemma.gguf')
    expect(p.systemPrompt).toBe('Be terse.')
    expect(p.history).toEqual([
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello' },
    ])
    expect(p.prompt).toBe('What is 2+2?')
    expect(p.stream).toBe(true)
    expect(p.temperature).toBe(0.2)
  })

  it('handles a single user message with no system', () => {
    const p = parseChatBody({ messages: [{ role: 'user', content: 'Yo' }] })
    expect(p.systemPrompt).toBeUndefined()
    expect(p.history).toEqual([])
    expect(p.prompt).toBe('Yo')
  })

  it('flattens array content parts and reads max_completion_tokens', () => {
    const p = parseChatBody({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }],
      max_completion_tokens: 50,
    })
    expect(p.prompt).toBe('ab')
    expect(p.maxTokens).toBe(50)
  })

  it('rejects malformed bodies', () => {
    expect(() => parseChatBody(null)).toThrow('JSON object')
    expect(() => parseChatBody({})).toThrow('messages')
    expect(() => parseChatBody({ messages: [] })).toThrow('non-empty')
    expect(() => parseChatBody({ messages: [{ role: 'system', content: 'only system' }] })).toThrow('user or assistant')
  })
})

describe('response shapes', () => {
  it('chat.completion carries content + estimated usage', () => {
    const r = chatCompletion({ id: 'x', created: 1, model: 'm', content: 'four', promptText: 'What is 2+2?' }) as any
    expect(r.object).toBe('chat.completion')
    expect(r.choices[0].message.content).toBe('four')
    expect(r.choices[0].finish_reason).toBe('stop')
    expect(r.usage.total_tokens).toBe(r.usage.prompt_tokens + r.usage.completion_tokens)
  })

  it('chunk carries a role opener then deltas then a finish', () => {
    expect((chatChunk({ id: 'x', created: 1, model: 'm', role: true }) as any).choices[0].delta.role).toBe('assistant')
    expect((chatChunk({ id: 'x', created: 1, model: 'm', delta: 'hi' }) as any).choices[0].delta.content).toBe('hi')
    expect((chatChunk({ id: 'x', created: 1, model: 'm', finishReason: 'stop' }) as any).choices[0].finish_reason).toBe('stop')
  })

  it('models list is OpenAI-shaped', () => {
    const r = modelsList([{ id: 'a.gguf', created: 0 }]) as any
    expect(r.object).toBe('list')
    expect(r.data[0]).toMatchObject({ id: 'a.gguf', object: 'model', owned_by: 'powerstation' })
  })

  it('embeddings response indexes each vector', () => {
    const r = embeddingsResponse('nomic', [[0.1, 0.2], [0.3]]) as any
    expect(r.data.map((d: any) => d.index)).toEqual([0, 1])
    expect(r.data[0].embedding).toEqual([0.1, 0.2])
  })
})

describe('embeddingInputs', () => {
  it('accepts string or array, caps and drops non-strings', () => {
    expect(embeddingInputs({ input: 'hi' })).toEqual(['hi'])
    expect(embeddingInputs({ input: ['a', 2, 'b', ''] })).toEqual(['a', 'b'])
    expect(embeddingInputs({})).toEqual([])
  })
})
