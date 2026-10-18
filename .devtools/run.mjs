// `npm test` 的入口：起一个服务，把界面自检依次跑一遍，汇总退出码。
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
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const PYTHON = process.env.EF_PYTHON || 'python'
// 界面自检也不许往用户的真档（data/elephantfish.sqlite）里写测试棋 ——
// 那本账是越下越厚的，跑一次自检多出六局假棋就废了。存档本身是可选的，
// 所以这里指到临时文件，而不是关掉它：关掉的话 HTTP 层少跑一条真实写路径。
const ARCHIVE = join(tmpdir(), `ef-run-${randomUUID()}.sqlite`)
// motion.mjs 守的是「动效还在不在」：编排成不成序列、悬停/按压有没有反馈、
// 有没有退化成 transition:all、reduced-motion 有没有真的压住。它坏掉时页面照样
// 能下棋，前面几套几何/位移断言一条都不会红 —— 所以它是独立的一票。
// grade-wording.mjs 守的是判分那句话**配不配得上那个数**：它不碰画面，
// 直接把 format.ts 里那个纯函数拿来问（Node 自带 TS 类型剥离，import 得动 .ts），
// 所以它跟服务起没起来无关，放在最后只是让画面那几套先出结论。
// replay.mjs 守的是复盘台：它自己得先下一小局、等判分落进存档，才有东西可回放，
// 所以它是这套里最慢的一票 —— 但它量的那块盘不在其它任何一套的视野里。
const CHECKS = ['audit.mjs', 'drag.mjs', 'kbd.mjs', 'frames.mjs', 'glide.mjs', 'motion.mjs',
  'replay.mjs', 'grade-wording.mjs']

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
  env: { ...process.env, EF_STORE_PATH: ARCHIVE },
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
