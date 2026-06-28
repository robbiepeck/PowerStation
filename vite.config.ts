import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Strict Content-Security-Policy for the packaged (file://) build only. The dev
// server needs inline scripts / eval / a websocket for HMR, so this is injected
// at build time and left out of `vite serve`. The renderer makes no direct
// network calls (everything goes through IPC), so 'self' is sufficient.
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

function cspPlugin(): Plugin {
  return {
    name: 'powerstation-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
})
