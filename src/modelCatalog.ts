export type StarterModel = {
  id: string
  name: string
  source: string
  uri: string
  parameters: string
  quantization: string
  downloadSize: string
  recommendedMemory: string
  license: string
  bestFor: string
  tone: 'compact' | 'balanced' | 'strong' | 'code'
  pros: string[]
  cons: string[]
}

export const STARTER_MODELS: StarterModel[] = [
  {
    id: 'qwen3-06b',
    name: 'Qwen3 0.6B',
    source: 'Qwen/Qwen3-0.6B-GGUF',
    uri: 'hf:Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf',
    parameters: '0.6B',
    quantization: 'Q8_0',
    downloadSize: '639 MB',
    recommendedMemory: '4 GB RAM',
    license: 'Apache-2.0',
    bestFor: 'Fast first run, weak laptops, quick offline tests',
    tone: 'compact',
    pros: ['Small download', 'Fast startup', 'Low memory pressure'],
    cons: ['Shallow reasoning', 'Weaker writing quality', 'Limited coding ability'],
  },
  {
    id: 'qwen3-4b',
    name: 'Qwen3 4B',
    source: 'Qwen/Qwen3-4B-GGUF',
    uri: 'hf:Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf',
    parameters: '4B',
    quantization: 'Q4_K_M',
    downloadSize: '2.50 GB',
    recommendedMemory: '8 GB RAM',
    license: 'Apache-2.0',
    bestFor: 'Everyday chat, summarising, lightweight reasoning',
    tone: 'balanced',
    pros: ['Good quality for size', 'Runs on most modern machines', 'Useful multilingual coverage'],
    cons: ['Slower than 0.6B', 'Can miss harder reasoning', 'Not specialist-grade for code'],
  },
  {
    id: 'qwen3-8b',
    name: 'Qwen3 8B',
    source: 'Qwen/Qwen3-8B-GGUF',
    uri: 'hf:Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf',
    parameters: '8B',
    quantization: 'Q4_K_M',
    downloadSize: '5.03 GB',
    recommendedMemory: '12 GB RAM',
    license: 'Apache-2.0',
    bestFor: 'Better reasoning, higher quality answers, longer work sessions',
    tone: 'strong',
    pros: ['Stronger answers', 'Better instruction following', 'Good general-purpose default'],
    cons: ['Larger download', 'Higher RAM pressure', 'Slower on CPU-only machines'],
  },
  {
    id: 'qwen25-coder-3b',
    name: 'Qwen2.5 Coder 3B',
    source: 'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF',
    uri: 'hf:Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/qwen2.5-coder-3b-instruct-q4_k_m.gguf',
    parameters: '3B',
    quantization: 'Q4_K_M',
    downloadSize: '2.10 GB',
    recommendedMemory: '8 GB RAM',
    license: 'Qwen research',
    bestFor: 'Code review, snippets, refactors, developer prompts',
    tone: 'code',
    pros: ['Code-focused tuning', 'Compact for a coding model', 'Good fit for local developer workflows'],
    cons: ['Model-specific license', 'Less capable as a general chat model', 'Not ideal for large repositories'],
  },
]
