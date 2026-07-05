// Skills: reusable instruction packs stored as plain markdown files in the
// user-data directory — readable, hand-editable, shareable. The app seeds a
// small set of starters on first run; which skills are *enabled* lives in
// config, so deleting or adding files by hand always does the obvious thing.

import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getState, mutate } from './config.js'
import {
  estimateSkillTokens,
  parseSkillFile,
  serializeSkillFile,
  slugifySkillName,
  type ParsedSkill,
} from './skillFormat.js'

export type SkillInfo = ParsedSkill & {
  slug: string
  enabled: boolean
  tokenEstimate: number
  builtIn: boolean
}

const MAX_SKILLS = 100

export function skillsDir(): string {
  return path.join(app.getPath('userData'), 'skills')
}

function bundledSkillsDir(): string {
  return path.join(app.getAppPath(), 'skills')
}

function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && /^[a-z0-9-]{1,60}$/.test(slug)
}

let seeded = false

/**
 * Copy the bundled starter skills into the user's skills folder on first run
 * only (the folder not existing is the signal) — a deliberately-deleted
 * starter must not resurrect on next launch.
 */
async function ensureSeeded(): Promise<void> {
  if (seeded) return
  seeded = true
  try {
    await fs.access(skillsDir())
    return // already initialised
  } catch {
    /* first run — seed below */
  }
  await fs.mkdir(skillsDir(), { recursive: true })
  let bundled: string[]
  try {
    bundled = (await fs.readdir(bundledSkillsDir())).filter((f) => f.endsWith('.md'))
  } catch {
    return
  }
  for (const file of bundled) {
    try {
      await fs.copyFile(path.join(bundledSkillsDir(), file), path.join(skillsDir(), file))
    } catch {
      /* skip unreadable starter */
    }
  }
}

async function bundledSlugs(): Promise<Set<string>> {
  try {
    const files = await fs.readdir(bundledSkillsDir())
    return new Set(files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3).toLowerCase()))
  } catch {
    return new Set()
  }
}

export async function listSkills(): Promise<SkillInfo[]> {
  await ensureSeeded()
  let files: string[]
  try {
    files = await fs.readdir(skillsDir())
  } catch {
    return []
  }
  const [state, builtIns] = await Promise.all([getState(), bundledSlugs()])
  const enabled = new Set(state.settings.utilities.enabledSkills)
  const skills: SkillInfo[] = []
  for (const file of files.slice(0, MAX_SKILLS)) {
    if (!file.endsWith('.md')) continue
    const slug = file.slice(0, -3).toLowerCase()
    if (!isValidSlug(slug)) continue
    let raw: string
    try {
      raw = await fs.readFile(path.join(skillsDir(), file), 'utf8')
    } catch {
      continue
    }
    const parsed = parseSkillFile(raw, slug)
    skills.push({
      ...parsed,
      slug,
      enabled: enabled.has(slug),
      tokenEstimate: estimateSkillTokens(parsed.body),
      builtIn: builtIns.has(slug),
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveSkill(payload: {
  slug?: unknown
  name: unknown
  description: unknown
  body: unknown
}): Promise<SkillInfo | null> {
  await ensureSeeded()
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'Untitled skill'
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  const body = typeof payload.body === 'string' ? payload.body : ''
  let slug = isValidSlug(payload.slug) ? payload.slug : slugifySkillName(name)
  // New skill with a colliding name: pick a free slug rather than overwrite.
  if (!isValidSlug(payload.slug)) {
    const existing = new Set((await listSkills()).map((s) => s.slug))
    let candidate = slug
    for (let n = 2; existing.has(candidate); n++) candidate = `${slug}-${n}`.slice(0, 60)
    slug = candidate
  }
  const skill: ParsedSkill = { name, description, body }
  await fs.writeFile(path.join(skillsDir(), `${slug}.md`), serializeSkillFile(skill), 'utf8')
  const state = await getState()
  return {
    ...parseSkillFile(serializeSkillFile(skill), slug),
    slug,
    enabled: state.settings.utilities.enabledSkills.includes(slug),
    tokenEstimate: estimateSkillTokens(body),
    builtIn: (await bundledSlugs()).has(slug),
  }
}

export async function deleteSkill(slug: unknown): Promise<boolean> {
  if (!isValidSlug(slug)) return false
  try {
    await fs.rm(path.join(skillsDir(), `${slug}.md`))
  } catch {
    return false
  }
  await mutate((state) => {
    state.settings.utilities.enabledSkills = state.settings.utilities.enabledSkills.filter((s) => s !== slug)
  })
  return true
}

export async function setSkillEnabled(slug: unknown, enabled: boolean): Promise<boolean> {
  if (!isValidSlug(slug)) return false
  await mutate((state) => {
    const list = state.settings.utilities.enabledSkills.filter((s) => s !== slug)
    if (enabled) list.push(slug)
    state.settings.utilities.enabledSkills = list.slice(0, MAX_SKILLS)
  })
  return true
}

export async function revealSkillsDir(): Promise<boolean> {
  await ensureSeeded()
  shell.showItemInFolder(skillsDir())
  return true
}

/** Bodies of all enabled skills, for system-prompt composition. */
export async function getEnabledSkills(): Promise<ParsedSkill[]> {
  const skills = await listSkills()
  return skills.filter((s) => s.enabled && s.body)
}
