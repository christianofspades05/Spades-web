import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      // Cron routes call external marketplace APIs (potentially paginated)
      // and write orders to the DB — the unconfigured default Vercel
      // function timeout isn't enough headroom, causing the external
      // scheduler (cron-job.org) to report "Timeout" even when the work
      // itself would otherwise complete. 300s is the max on a standard
      // Vercel Pro function (no Fluid Compute).
      vercel: {
        functionRules: {
          '/api/cron/**': { maxDuration: 300 },
        },
      },
    }),
    viteReact(),
  ],
})

export default config
