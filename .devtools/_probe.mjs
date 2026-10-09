import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome' })
const p = await (await b.newContext({viewport:{width:1600,height:980}})).newPage()
p.on('requestfailed', r => console.log('FAILED', r.method(), r.url(), '::', r.failure()?.errorText))
p.on('response', r => { if (r.url().includes('/api') || r.url().includes('favicon')) console.log('RESP', r.status(), r.url()) })
await p.goto(process.argv[2] || 'http://127.0.0.1:8020/', { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await b.close()
