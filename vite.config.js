import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

function copyFFmpegWasm() {
  return {
    name: 'copy-ffmpeg-wasm',
    buildStart() {
      const stDest = 'public/ffmpeg-st'
      const mtDest = 'public/ffmpeg-mt'

      if (!existsSync(stDest)) mkdirSync(stDest, { recursive: true })
      if (!existsSync(mtDest)) mkdirSync(mtDest, { recursive: true })

      const stSrc = join('node_modules', '@ffmpeg', 'core', 'dist', 'esm')
      const mtSrc = join('node_modules', '@ffmpeg', 'core-mt', 'dist', 'esm')

      for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
        copyFileSync(join(stSrc, f), join(stDest, f))
        copyFileSync(join(mtSrc, f), join(mtDest, f))
      }
      copyFileSync(join(mtSrc, 'ffmpeg-core.worker.js'), join(mtDest, 'ffmpeg-core.worker.js'))
    },
  }
}

export default defineConfig({
  plugins: [react(), copyFFmpegWasm()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
