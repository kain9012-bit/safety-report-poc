import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

/**
 * `npm run dev`에서도 api/ 서버 함수가 돌게 한다 — 배포(Vercel)와 같은 코드를 그대로 부른다.
 * .env.local 의 키는 이 Node 프로세스에서만 읽힌다. 브라우저 번들에는 들어가지 않는다.
 */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      // /api/<이름> → api/<이름>.ts 의 GET·POST
      server.middlewares.use('/api', async (req, res, next) => {
        const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost')
        const name = url.pathname.replace(/^\/api\//, '')
        if (!/^[a-z]+$/.test(name)) return next()
        try {
          const mod = (await server.ssrLoadModule(`/api/${name}.ts`)) as Record<
            string,
            ((r: Request) => Promise<Response>) | undefined
          >
          const method = (req.method ?? 'GET').toUpperCase()
          const handler = mod[method]
          if (!handler) {
            res.statusCode = 405
            return res.end()
          }
          let body: Buffer | undefined
          if (method !== 'GET' && method !== 'HEAD') {
            const chunks: Buffer[] = []
            for await (const c of req) chunks.push(c as Buffer)
            body = Buffer.concat(chunks)
          }
          const out = await handler(
            new Request(url, {
              method,
              headers: { 'content-type': String(req.headers['content-type'] ?? '') },
              body,
            }),
          )
          res.statusCode = out.status
          out.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await out.arrayBuffer()))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'dev_api', message: String(e) }))
        }
      })
    },
  }
}

/**
 * 화면 구석에 찍을 빌드 표식 — "방금 고친 게 배포됐나"에 커밋 해시로 답한다.
 * Vercel 은 VERCEL_GIT_COMMIT_SHA 를 준다. 로컬은 git 에서 읽고, 커밋 안 한 변경이 있으면 + 를 붙인다.
 * (팀원 저장소 kjy-arch/parking-report 의 빌드 표식을 따랐다.)
 */
function buildSha(): string {
  const v = process.env.VERCEL_GIT_COMMIT_SHA
  if (v) return v.slice(0, 7)
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return dirty ? `${sha}+` : sha
  } catch {
    return 'unknown'
  }
}

export default defineConfig(({ mode }) => {
  // 접두사 없이 모두 읽어 서버 함수(process.env)에 넘긴다. VITE_ 가 아닌 값은 브라우저로 가지 않는다.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    base: './',
    plugins: [react(), tailwindcss(), devApi()],
    define: {
      __BUILD_SHA__: JSON.stringify(buildSha()),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    // 신고 화면(index.html) + 판독 채점 화면(eval.html)
    build: { rollupOptions: { input: { main: 'index.html', eval: 'eval.html' } } },
  }
})
