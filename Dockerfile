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
# NEXT_PUBLIC_* vars are inlined into the compiled JS by `next build` — they
# can't be swapped in later at container runtime the way server-only env vars
# can (that's the whole mechanism Next.js uses to expose a value to browser
# code, which has no access to the real process.env at all). So these three
# MUST be real values at build time, not placeholders — Railway forwards
# matching service Variables as build args automatically because these ARGs
# exist. The `docker build` default lets local/CI builds without --build-arg
# still succeed (the app just won't reach a real Supabase instance).
ARG NEXT_PUBLIC_SUPABASE_URL="https://placeholder.supabase.co"
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder"
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# SUPABASE_SERVICE_ROLE_KEY is server-only (no NEXT_PUBLIC_ prefix) — Next.js
# never inlines it, so the real value injected by Railway at container
# runtime is genuinely used. This placeholder only satisfies the `!` non-null
# assertion in lib/supabase/admin.ts so `next build` doesn't crash — no route
# or server action actually runs during the build.
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
