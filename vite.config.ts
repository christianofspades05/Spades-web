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
      // `functions` sets the base config applied to the app's single
      // catch-all server function (__server.func — every page load AND
      // every admin server action, e.g. clicking "Recheck last 30 days" on
      // a Channels page, goes through it). Left unconfigured, Vercel's
      // short default timeout silently killed longer-running admin actions
      // (a wide-window marketplace order pull) with no error surfaced
      // anywhere — the request just never came back. `functionRules` below
      // instead creates a SEPARATE dedicated function per matched route
      // pattern (merged on top of this base config), which is why cron
      // needed its own explicit entry rather than relying on this alone —
      // see sync-channels-pull-orders.ts's cron-job.org "Timeout" reports.
      // 300s is the max on a standard Vercel Pro function (no Fluid Compute).
      vercel: {
        functions: { maxDuration: 300 },
        functionRules: {
          '/api/cron/**': { maxDuration: 300 },
        },
      },
    }),
    viteReact(),
  ],
})

export default config
