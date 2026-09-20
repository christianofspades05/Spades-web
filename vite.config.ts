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
      // anywhere — the request just never came back. This base 800s can't
      // be narrowed further without also clipping that admin action, since
      // every server function (including it) shares this one catch-all —
      // there's no route-level way to give just that action a long timeout.
      // 800s is the max Vercel allows at all, available because Fluid
      // Compute is enabled on this project (a plain Pro function without it
      // caps at 300s).
      //
      // `functionRules` below DOES let cron routes be split apart, since
      // each one is a real, separately-addressable HTTP route (unlike the
      // admin action above) — a stuck or slow cron route now only risks
      // billing for its own ceiling, not the global 800s max, and a bug in
      // one no longer masks a timeout in another. Only the two
      // marketplace-sync crons do genuinely long, sequential per-order work
      // and keep the full 800s; the rest do small, bounded work.
      vercel: {
        functions: { maxDuration: 800 },
        functionRules: {
          '/api/cron/sync-channels-daily': { maxDuration: 800 },
          '/api/cron/sync-channels-pull-orders': { maxDuration: 800 },
          '/api/cron/abandoned-cart': { maxDuration: 300 },
          '/api/cron/birthday': { maxDuration: 60 },
          '/api/cron/review-requests': { maxDuration: 60 },
          '/api/cron/sync-exchange-rates': { maxDuration: 60 },
          '/api/cron/expire-unpaid-orders': { maxDuration: 60 },
        },
      },
    }),
    viteReact(),
  ],
})

export default config
