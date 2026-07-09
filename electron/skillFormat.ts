export type ParsedSkill = {
  name: string
  description: string
  body: string

  triggers: string[]
}

export type SkillMode = 'off' | 'auto' | 'always'

const MAX_NAME = 60
const MAX_DESCRIPTION = 160
const MAX_BODY = 24_000

export function parseSkillFile(raw: string, fallbackName: string): ParsedSkill {
  const text = raw.replace(/\r\n/g, '\n')
  let name = fallbackName
  let description = ''
  let triggers: string[] = []
  let body = text

  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (match) {
    body = text.slice(match[0].length)
    for (const line of match[1].split('\n')) {
      const sep = line.indexOf(':')
      if (sep === -1) continue
      const key = line.slice(0, sep).trim().toLowerCase()
      const value = line.slice(sep + 1).trim()
      if (key === 'name' && value) name = value
      if (key === 'description' && value) description = value
      if (key === 'triggers' && value) {
        triggers = value
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 1)
          .slice(0, 20)
      }
    }
  }

  return {
    name: name.slice(0, MAX_NAME),
    description: description.slice(0, MAX_DESCRIPTION),
    body: body.trim().slice(0, MAX_BODY),
    triggers,
  }
}

export function serializeSkillFile(skill: ParsedSkill): string {
  const name = skill.name.replace(/\n/g, ' ').slice(0, MAX_NAME)
  const description = skill.description.replace(/\n/g, ' ').slice(0, MAX_DESCRIPTION)
  const triggersLine = skill.triggers.length ? `\ntriggers: ${skill.triggers.join(', ')}` : ''
  return `---\nname: ${name}\ndescription: ${description}${triggersLine}\n---\n\n${skill.body.trim().slice(0, MAX_BODY)}\n`
}

export function estimateSkillTokens(body: string): number {
  return Math.ceil(body.length / 4)
}

export function slugifySkillName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'skill'
}

export function skillMatchesMessage(skill: ParsedSkill, message: string): boolean {
  const haystack = message.toLowerCase()
  const triggers = skill.triggers.length
    ? skill.triggers
    : skill.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3)
  return triggers.some((trigger) => haystack.includes(trigger))
}

export function composeSystemPrompt(basePrompt: string, skills: ParsedSkill[]): string {
  const parts: string[] = []
  const base = basePrompt.trim()
  if (base) parts.push(base)
  for (const skill of skills) {
    if (!skill.body) continue
    parts.push(`## Skill: ${skill.name}\n${skill.body}`)
  }
  return parts.join('\n\n')
}
