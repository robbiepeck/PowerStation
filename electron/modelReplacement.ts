import path from 'node:path'

export type ReplacementDisposition = 'keep' | 'delete' | 'detach'

export function replacementDisposition(
  managedRoot: string,
  candidatePath: string,
  targetPath: string,
): ReplacementDisposition {
  const root = path.resolve(managedRoot)
  const candidate = path.resolve(candidatePath)
  const target = path.resolve(targetPath)
  if (candidate === target) return 'keep'
  if (candidate === root || candidate.startsWith(root + path.sep)) return 'delete'
  return 'detach'
}
