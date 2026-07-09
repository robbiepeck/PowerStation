import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getState, mutate } from './config.js'
import {
  estimateSkillTokens,
  parseSkillFile,
  serializeSkillFile,
  skillMatchesMessage,
  slugifySkillName,
  type ParsedSkill,
  type SkillMode,
} from './skillFormat.js'

export type SkillInfo = ParsedSkill & {
  slug: string
  mode: SkillMode
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

const ORIGINAL_STARTERS = ['action-items', 'code-reviewer', 'concise-answers', 'step-by-step-tutor', 'writing-editor']

async function ensureSeeded(): Promise<void> {
  if (seeded) return
  seeded = true

  const hadFolder = await fs.access(skillsDir()).then(
    () => true,
    () => false,
  )
  await fs.mkdir(skillsDir(), { recursive: true }).catch(() => undefined)
  let bundled: string[]
  try {
    bundled = (await fs.readdir(bundledSkillsDir())).filter((f) => f.endsWith('.md'))
  } catch {
    return
  }
  const state = await getState()
  const offered = new Set(state.seededSkillSlugs.length ? state.seededSkillSlugs : hadFolder ? ORIGINAL_STARTERS : [])
  const newlyOffered: string[] = []
  for (const file of bundled) {
    const slug = file.slice(0, -3).toLowerCase()
    if (offered.has(slug)) continue
    const dest = path.join(skillsDir(), file)
    const alreadyThere = await fs.access(dest).then(
      () => true,
      () => false,
    )
    if (!alreadyThere) {
      try {
        await fs.copyFile(path.join(bundledSkillsDir(), file), dest)
      } catch {
        continue
      }
    }
    newlyOffered.push(slug)
  }
  const toRecord = [...new Set([...offered, ...newlyOffered])]
  if (toRecord.length !== state.seededSkillSlugs.length) {
    await mutate((current) => {
      current.seededSkillSlugs = toRecord
    })
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
  const modes = state.settings.utilities.skillModes
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
      mode: modes[slug] ?? 'off',
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
  triggers?: unknown
}): Promise<SkillInfo | null> {
  await ensureSeeded()
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'Untitled skill'
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  const body = typeof payload.body === 'string' ? payload.body : ''
  const triggers =
    typeof payload.triggers === 'string'
      ? payload.triggers
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 1)
          .slice(0, 20)
      : []
  let slug = isValidSlug(payload.slug) ? payload.slug : slugifySkillName(name)

  if (!isValidSlug(payload.slug)) {
    const existing = new Set((await listSkills()).map((s) => s.slug))
    let candidate = slug
    for (let n = 2; existing.has(candidate); n++) candidate = `${slug}-${n}`.slice(0, 60)
    slug = candidate
  }
  const skill: ParsedSkill = { name, description, body, triggers }
  await fs.writeFile(path.join(skillsDir(), `${slug}.md`), serializeSkillFile(skill), 'utf8')
  const state = await getState()
  return {
    ...parseSkillFile(serializeSkillFile(skill), slug),
    slug,
    mode: state.settings.utilities.skillModes[slug] ?? 'off',
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
    delete state.settings.utilities.skillModes[slug]
  })
  return true
}

export async function setSkillMode(slug: unknown, mode: SkillMode): Promise<boolean> {
  if (!isValidSlug(slug)) return false
  if (mode !== 'off' && mode !== 'auto' && mode !== 'always') return false
  await mutate((state) => {
    if (mode === 'off') delete state.settings.utilities.skillModes[slug]
    else state.settings.utilities.skillModes[slug] = mode
  })
  return true
}

export async function revealSkillsDir(): Promise<boolean> {
  await ensureSeeded()
  shell.showItemInFolder(skillsDir())
  return true
}

export async function getActiveSkills(
  message?: string,

  modeOverrides?: Record<string, SkillMode>,
): Promise<SkillInfo[]> {
  const skills = await listSkills()
  return skills.filter((skill) => {
    const mode = modeOverrides?.[skill.slug] ?? skill.mode
    if (!skill.body || mode === 'off') return false
    if (mode === 'always') return true
    return message ? skillMatchesMessage(skill, message) : false
  })
}
