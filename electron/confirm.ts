import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'

let promptActive = false

/**
 * Security-sensitive approval must be owned by the main process, not by HTML
 * that a compromised renderer could click or forge. Only one native prompt is
 * allowed at a time; concurrent/spam attempts fail closed.
 */
export async function showSecurityPrompt(
  win: BrowserWindow | null,
  options: MessageBoxOptions,
): Promise<number> {
  if (promptActive || !win || win.isDestroyed()) return options.cancelId ?? 0
  promptActive = true
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      noLink: true,
      normalizeAccessKeys: false,
      defaultId: options.cancelId ?? 0,
      ...options,
    })
    return result.response
  } finally {
    promptActive = false
  }
}
