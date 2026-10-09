// 诊断：把浏览器发出的每个 /api 请求连同响应体打出来
import { chromium } from 'playwright-core'

const url = process.argv[2] || 'http://127.0.0.1:8020/'
const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 980 } })
const page = await ctx.newPage()

page.on('request', (r) => {
  if (r.url().includes('/api/')) {
    console.log(`→ ${r.method()} ${r.url().replace(/^.*\/api/, '/api')}  body=${r.postData() ?? ''}`)
  }
})
page.on('response', async (r) => {
  if (r.url().includes('/api/')) {
    let body = ''
    try {
      body = (await r.text()).slice(0, 220)
    } catch {
      body = '<读取失败>'
    }
    console.log(`← ${r.status()} ${r.url().replace(/^.*\/api/, '/api')}  ${body}`)
  }
})

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)

console.log('--- 试点一次录入 ---')
const enabled = await page.evaluate(() => {
  const i = document.querySelector('.relay-field input')
  return i ? !i.disabled : null
})
console.log('输入框可用:', enabled)

await page.waitForFunction(
  () => {
    const i = document.querySelector('.relay-field input')
    return i && !i.disabled
  },
  { timeout: 25000 },
)
await page.fill('.relay-field input', 'b2e2')
await page.waitForTimeout(200)
const val = await page.inputValue('.relay-field input')
console.log('输入框里的值:', JSON.stringify(val))
await page.press('.relay-field input', 'Enter')
await page.waitForTimeout(3000)

await browser.close()
