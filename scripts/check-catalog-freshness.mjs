import { readFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT_MS = 30_000

const SPLIT_PART = /-\d{5}-of-\d{5}\.gguf$/i
const SIZE_TOLERANCE = 0.01
const HF_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const HF_REVISION = /^[a-f0-9]{40}$/i
const NPM_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const failures = []
const warnings = []
const passes = []

async function headOrRange(url) {

  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) {
      const length = Number(res.headers.get('content-length') ?? 0)
      return { ok: true, status: res.status, length }
    }
    if (res.status !== 405 && res.status !== 403) return { ok: false, status: res.status, length: 0 }
  } catch (error) {
    if (error.name === 'TimeoutError') return { ok: false, status: 0, length: 0, note: 'timeout' }

  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const range = res.headers.get('content-range')
    const total = range ? Number(range.split('/')[1]) : 0
    res.body?.cancel?.()
    return { ok: res.ok, status: res.status, length: Number.isFinite(total) ? total : 0 }
  } catch (error) {
    return { ok: false, status: 0, length: 0, note: error.name === 'TimeoutError' ? 'timeout' : String(error) }
  }
}

async function checkModels() {
  const catalog = JSON.parse(await readFile(path.join(root, 'catalog', 'models.json'), 'utf8'))
  for (const model of catalog.models) {
    let parsedDownload
    try { parsedDownload = new URL(model.downloadUrl) } catch { parsedDownload = null }
    const parts = parsedDownload?.pathname.split('/') ?? []
    if (!HF_REPO.test(model.hfRepo ?? '') || !parsedDownload || parsedDownload.protocol !== 'https:' || parsedDownload.hostname !== 'huggingface.co' || parts[1] !== model.hfRepo?.split('/')[0] || parts[2] !== model.hfRepo?.split('/')[1] || parts[3] !== 'resolve' || !HF_REVISION.test(parts[4] ?? '')) {
      failures.push(`**${model.id}** download URL is not a pinned Hugging Face resolve URL: ${model.downloadUrl}`)
      continue
    }
    const download = await headOrRange(model.downloadUrl)
    if (!download.ok) {
      failures.push(`**${model.id}** download URL broken (HTTP ${download.status}${download.note ? `, ${download.note}` : ''}): ${model.downloadUrl}`)
    } else if (!SPLIT_PART.test(model.fileName) && download.length > 0) {
      const drift = Math.abs(download.length - model.sizeBytes) / model.sizeBytes
      if (drift > SIZE_TOLERANCE) {
        failures.push(
          `**${model.id}** size drift: catalog says ${model.sizeBytes.toLocaleString()} bytes, server says ${download.length.toLocaleString()} (${(drift * 100).toFixed(1)}%) — the file changed; re-verify geometry and size`,
        )
      } else {
        passes.push(`${model.id}: download OK, size matches`)
      }
    } else {
      passes.push(`${model.id}: download OK${SPLIT_PART.test(model.fileName) ? ' (split model, size skipped)' : ''}`)
    }

    const website = await headOrRange(model.websiteUrl)
    if (!website.ok) {
      warnings.push(`**${model.id}** website URL broken (HTTP ${website.status}): ${model.websiteUrl}`)
    }

    if (model.vision) {
      const mmproj = await headOrRange(model.vision.mmprojUrl)
      if (!mmproj.ok) {
        failures.push(`**${model.id}** mmproj URL broken (HTTP ${mmproj.status}): ${model.vision.mmprojUrl}`)
      } else if (mmproj.length > 0 && Math.abs(mmproj.length - model.vision.mmprojSizeBytes) / model.vision.mmprojSizeBytes > SIZE_TOLERANCE) {
        failures.push(`**${model.id}** mmproj size drift: catalog ${model.vision.mmprojSizeBytes}, server ${mmproj.length}`)
      } else {
        passes.push(`${model.id}: mmproj OK`)
      }
    }
  }
}

async function checkConnectors() {
  const catalog = JSON.parse(await readFile(path.join(root, 'catalog', 'connectors.json'), 'utf8'))
  for (const connector of catalog.connectors) {
    if (!NPM_VERSION.test(connector.version ?? '')) {
      failures.push(`**${connector.id}** must pin an exact npm version: ${connector.npmPackage}`)
      continue
    }
    const encoded = connector.npmPackage.replace('/', '%2F')
    try {
      const res = await fetch(`https://registry.npmjs.org/${encoded}/latest`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        failures.push(`**${connector.id}** npm package missing (HTTP ${res.status}): ${connector.npmPackage}`)
        continue
      }
      const meta = await res.json()
      if (meta.version !== connector.version) {
        failures.push(`**${connector.id}** pins ${connector.npmPackage}@${connector.version}, but the registry reports ${meta.version}`)
        continue
      }
      if (meta.deprecated) {
        warnings.push(`**${connector.id}** npm package is deprecated: ${connector.npmPackage} — "${meta.deprecated}"`)
      } else {
        passes.push(`${connector.id}: npm OK (${connector.npmPackage}@${meta.version})`)
      }
    } catch (error) {
      failures.push(`**${connector.id}** npm check failed: ${connector.npmPackage} (${error.name})`)
    }
  }
}

async function checkSkills() {

  const catalog = JSON.parse(await readFile(path.join(root, 'catalog', 'skills.json'), 'utf8'))
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.skills) || catalog.skills.length === 0) {
    failures.push('**skills.json** invalid: schemaVersion must be 1 with a non-empty skills array')
    return
  }
  const seen = new Set()
  for (const skill of catalog.skills) {
    const label = skill?.id ?? '(missing id)'
    if (!/^[a-z0-9-]{1,60}$/.test(skill?.id ?? '')) failures.push(`**skills.json** entry has bad id: ${label}`)
    else if (seen.has(skill.id)) failures.push(`**skills.json** duplicate id: ${label}`)
    else seen.add(skill.id)
    if (typeof skill?.name !== 'string' || !skill.name.trim()) failures.push(`**${label}** missing name`)
    if (typeof skill?.body !== 'string' || skill.body.length < 40) failures.push(`**${label}** body missing or too short`)
    else passes.push(`skill ${label}: valid (~${Math.ceil(skill.body.length / 4)} tok)`)
  }
}

async function checkRuntimeUpdates() {

  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    const installed = String(pkg.dependencies['node-llama-cpp'] ?? '').replace(/^[^0-9]*/, '')
    const res = await fetch('https://registry.npmjs.org/node-llama-cpp/latest', { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return
    const { version: latest } = await res.json()
    if (latest && installed && latest !== installed) {
      warnings.push(
        `**node-llama-cpp ${latest} is out** (app pins ${installed}) — check the release notes for multimodal/vision support; see docs/vision-plan.md`,
      )
    } else {
      passes.push(`runtime: node-llama-cpp up to date (${installed})`)
    }
  } catch {
    void 0
  }
}

await checkModels()
await checkConnectors()
await checkSkills()
await checkRuntimeUpdates()

const lines = [
  '## Catalogue freshness report',
  '',
  `- Passed: ${passes.length}`,
  `- Warnings: ${warnings.length}`,
  `- Failures: ${failures.length}`,
  '',
]
if (failures.length) lines.push('### Failures', '', ...failures.map((f) => `- ${f}`), '')
if (warnings.length) lines.push('### Warnings', '', ...warnings.map((w) => `- ${w}`), '')
lines.push('<details><summary>All checks</summary>', '', ...passes.map((p) => `- ${p}`), '', '</details>')

const report = lines.join('\n')
console.log(report)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n')

process.exit(failures.length ? 1 : 0)
