# 3-stage build: deps -> builder -> runner. Final image only carries the
# standalone Next.js server output, not the full source tree or dev deps.
# See docs/RAILWAY-DEPLOYMENT.md.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Real Supabase/app secrets are irrelevant at build time (no server action or
# route runs during `next build`) — these dummy values just satisfy the `!`
# non-null assertions in lib/supabase/*.ts so the build doesn't crash on
# undefined env vars. Real values are injected at container runtime by Railway.
ENV NEXT_PUBLIC_SUPABASE_URL="https://placeholder.supabase.co"
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder"
ENV SUPABASE_SERVICE_ROLE_KEY="placeholder"
RUN node node_modules/next/dist/bin/next build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
