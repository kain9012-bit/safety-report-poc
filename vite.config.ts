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
      server.middlewares.use('/api/address', async (req, res) => {
        try {
          const mod = (await server.ssrLoadModule('/api/address.ts')) as {
            GET: (r: Request) => Promise<Response>
          }
          const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost')
          const out = await mod.GET(new Request(url))
          res.statusCode = out.status
          out.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(await out.text())
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
  }
})
