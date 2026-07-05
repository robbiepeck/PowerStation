// The skill file format: plain markdown with a tiny frontmatter block, so
// skills are readable, hand-editable, and shareable outside the app.
//
//   ---
//   name: Concise answers
//   description: Short, direct replies without filler.
//   ---
//   When answering, be brief...
//
// Pure functions only — this module is unit-tested without Electron.

export type ParsedSkill = {
  name: string
  description: string
  body: string
}

const MAX_NAME = 60
const MAX_DESCRIPTION = 160
const MAX_BODY = 24_000

export function parseSkillFile(raw: string, fallbackName: string): ParsedSkill {
  const text = raw.replace(/\r\n/g, '\n')
  let name = fallbackName
  let description = ''
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
    }
  }

  return {
    name: name.slice(0, MAX_NAME),
    description: description.slice(0, MAX_DESCRIPTION),
    body: body.trim().slice(0, MAX_BODY),
  }
}

export function serializeSkillFile(skill: ParsedSkill): string {
  const name = skill.name.replace(/\n/g, ' ').slice(0, MAX_NAME)
  const description = skill.description.replace(/\n/g, ' ').slice(0, MAX_DESCRIPTION)
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${skill.body.trim().slice(0, MAX_BODY)}\n`
}

/** Same rough chars/4 heuristic the tool-schema meter uses. */
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

/**
 * Compose the effective system prompt: the user's base prompt plus every
 * enabled skill, each under a clear heading so models treat them as standing
 * instructions rather than conversation.
 */
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
