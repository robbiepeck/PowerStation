import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
})
