// `npm test` 的入口：起一个服务，把三套界面自检依次跑一遍，汇总退出码。
//
// 为什么需要它：`.devtools/package.json` 以前**没有任何 scripts**，也就是说
// README 里写的 `npm test = audit + drag + kbd` 是句空话 —— 那条命令什么都没跑。
// 而三个脚本里有两个因为选择器失效恒红、一个从不 process.exit 恒绿，于是
// 「界面自检全绿」这件事从来没有事实依据。
//
// 自己起服务是刻意的：以前得先手动 `python server/app.py 8010` 再跑脚本，
// 忘了起就得到一堆连接错误。这里找空闲端口、等健康检查、跑完关掉。
//
//   node run.mjs                     # 自动挑端口
//   node run.mjs --port 8040         # 指定端口
//   EF_PYTHON=py node run.mjs        # 指定解释器（默认 python）
//
// 传参给单个脚本：  node run.mjs --only drag

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const PYTHON = process.env.EF_PYTHON || 'python'
const CHECKS = ['audit.mjs', 'drag.mjs', 'kbd.mjs']

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function freePort(start) {
  for (let port = start; port < start + 40; port += 1) {
    const ok = await new Promise((res) => {
      const srv = createServer()
      srv.once('error', () => res(false))
      srv.once('listening', () => srv.close(() => res(true)))
      srv.listen(port, '127.0.0.1')
    })
    if (ok) return port
  }
  throw new Error(`从 ${start} 起找不到空闲端口`)
}

const port = Number(arg('port', 0)) || (await freePort(8020))
const url = `http://127.0.0.1:${port}/`
const only = arg('only')

console.log(`elephantfish 界面自检`)
console.log(`  服务 ${url}   解释器 ${PYTHON}\n`)

// ---- 起服务 ---- //
const server = spawn(PYTHON, [join('server', 'app.py'), String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

const stopServer = () => {
  if (server.exitCode === null) server.kill()
}
process.on('exit', stopServer)
process.on('SIGINT', () => {
  stopServer()
  process.exit(130)
})

async function waitHealthy(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`服务进程已退出（码 ${server.exitCode}）：\n${serverLog}`)
    }
    try {
      const r = await fetch(`${url}api/health`)
      if (r.ok) return await r.json()
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`服务 30 秒内没起来：\n${serverLog}`)
}

let health
try {
  health = await waitHealthy()
} catch (e) {
  console.log(String(e.message))
  stopServer()
  process.exit(1)
}
console.log(`  引擎 ${health.engine}   皮卡鱼可用 ${health.pikafish_available}   ` +
  `Python ${health.python}\n`)

// ---- 依次跑 ---- //
const runOne = (file) =>
  new Promise((res) => {
    const child = spawn(process.execPath, [join(here, file), url], {
      cwd: here,
      stdio: 'inherit',
    })
    child.on('exit', (code) => res(code ?? 1))
  })

const results = []
for (const file of CHECKS) {
  // `--only drag` 与 `--only drag.mjs` 都收：前者手打更省事，不该因为少了扩展名就空跑。
  if (only && file !== only && file !== `${only}.mjs`) continue
  const code = await runOne(file)
  results.push({ file, code })
  console.log('')
}

stopServer()

// ---- 汇总 ---- //
console.log('='.repeat(64))
console.log('  界面自检汇总')
console.log('='.repeat(64))
let failed = 0
for (const { file, code } of results) {
  const mark = code === 0 ? 'ok  ' : 'FAIL'
  console.log(`  [${mark}] ${file.padEnd(12)} 退出码 ${code}`)
  if (code !== 0) failed += 1
}
if (!results.length) {
  console.log(`  （--only ${only} 没匹配到任何脚本）`)
  process.exit(1)
}
console.log(
  failed ? `\n  ${failed}/${results.length} 套失败` : `\n  —— ${results.length} 套全绿 ——`,
)
process.exit(failed ? 1 : 0)
