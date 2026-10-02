import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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

export default defineConfig(({ mode }) => {
  // 접두사 없이 모두 읽어 서버 함수(process.env)에 넘긴다. VITE_ 가 아닌 값은 브라우저로 가지 않는다.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    base: './',
    plugins: [react(), tailwindcss(), devApi()],
    // 신고 화면(index.html) + 판독 채점 화면(eval.html)
    build: { rollupOptions: { input: { main: 'index.html', eval: 'eval.html' } } },
  }
})
