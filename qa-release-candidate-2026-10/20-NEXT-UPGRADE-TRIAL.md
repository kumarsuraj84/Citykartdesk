# 20 — Next.js 16.4.3 upgrade: trial result (nothing applied to the real project)

Why: `npm audit` lists Next.js 16.3.8 as **critical** (report 15, QA-D005). Fix version: 16.4.3 (a minor step).

What was done: a **separate scratch copy** of the project (so the real project, its `node_modules` and your running dev server were not touched) got `next@16.4.3`. Then, under the isolation gate:

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Whole regression (2,433 tests, same configuration as the final run) | 2,414 passed, 0 real failures, 18 skipped (WhatsApp). The first pass showed 4 failed files: 3 only because I had left the `.env.local` file out of the scratch copy, 1 (`nudge-ticket`, a timing-sensitive mail check) passed when re-run; the 4 files re-run = 11/11 passed (`evidence/next-16.4.3-trial/`) |
| QA app started on 16.4.3 (development mode, guard on) | sign-in, My requests, a ticket page, the new-request form all loaded; health ok |
| `npm audit` after the upgrade | Next.js is no longer listed. Critical 3 → 2 (both are the **test tool** vitest / tinypool, not part of the running site); high 6 (shadcn, body-parser, undici, vite, zod — build/test tooling or low-exposure, unchanged) |
| Side effect to know | on 16.4.3, `next dev` rewrites the wording of the block inside `AGENTS.md` a little (it says so itself). Harmless; commit that change or set `agentRules: false` in `next.config.ts` |
| Not done | a production build (`next build`) — the build downloads Google Fonts which the guard refuses; do it once on the build machine as for any deploy |

## To apply when you say yes
```
npm install next@16.4.3 eslint-config-next@16.4.3 --save-exact
```
then run `npm run typecheck`, the full test run and one production build, and deploy as usual. Rollback: put `16.3.8` back in `package.json` and `npm install`.
