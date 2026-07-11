export function shouldUseSystemInformationMemory(platform: NodeJS.Platform): boolean {
  // systeminformation's macOS memory probe shells out synchronously on every
  // sample. In Electron that can surface an asynchronous write EPIPE as an
  // uncaught main-process exception. Node's os metrics are sufficient here;
  // the kernel pressure signal remains the authoritative macOS health metric.
  return platform !== 'darwin'
}
