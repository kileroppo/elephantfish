import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import '../../styles/modules/boot.css'

interface BootScreenProps {
  booting?: boolean
  onRetry?: () => void
}

/** 启动叙事的三态。本地一个 /api/state 请求 <250ms 走完，三态只是闪一下；
 *  冷引擎 / 真实网络下这才是产品真正的第一帧 —— 三态让等待变得可读。
 *  第三态「激活」后会一直停在那里等真实回应：不假装完成。 */
const BOOT_STAGES = [
  { label: '连接教练服务', done: '已连接' },
  { label: '读取棋谱与存档', done: '已就位' },
  { label: '唤醒引擎，铺开棋盘', done: '已唤醒' },
]

/** 三态各自最短的停留：短于此看不出叙事，长于此就是磨蹭 */
const STAGE_STEP_MS = [420, 1000]

/** 只有本机部署才值得看那行启动命令；访客看到的是人话。 */
function isLocalDeploy(): boolean {
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.startsWith('127.')
}

export function BootScreen({ booting, onRetry }: BootScreenProps) {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    if (!booting) return
    const timers = STAGE_STEP_MS.map((ms, i) =>
      window.setTimeout(() => setStage(i + 1), ms),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [booting])

  if (booting) {
    return (
      <div className="boot" role="status">
        <div className="boot-veil" aria-hidden="true" />
        <div className="boot-inner">
          <div className="boot-seal" aria-hidden="true">
            象
          </div>
          <h1 className="boot-title">别急，棋还没开始。</h1>
          <p className="boot-sub">
            引擎正在就位。趁这一步工夫，把呼吸放慢 —— 这一局，看懂比走快更要紧。
          </p>
          <ol className="boot-steps" data-stage={stage}>
            {BOOT_STAGES.map((s, i) => {
              const state = i < stage ? 'done' : i === stage ? 'active' : 'pending'
              return (
                <li
                  key={s.label}
                  className="boot-step"
                  data-state={state}
                  style={{ '--i': i } as CSSProperties}
                >
                  <span className="boot-step-dot" aria-hidden="true" />
                  <span className="boot-step-label">{s.label}</span>
                  <span className="boot-step-state">
                    {state === 'done' ? s.done : state === 'active' ? '进行中…' : '等待中'}
                  </span>
                </li>
              )
            })}
          </ol>
          <p className="boot-colophon">XQ-Coach · 象棋教练实训台</p>
        </div>
      </div>
    )
  }

  return (
    <div className="boot" role="alert">
      <div className="boot-veil" aria-hidden="true" />
      <div className="boot-inner">
        <div className="boot-seal is-muted" aria-hidden="true">
          象
        </div>
        <h2 className="boot-error-title">没连上教练服务</h2>
        <div className="boot-error-body">
          <p>服务没有应答。棋谱、错题、当前局面都原样存在，一步也没丢。</p>
          <p>等服务回到线上，点「重试」即可 —— 棋局接着这里下。</p>
        </div>
        {isLocalDeploy() ? (
          <p className="boot-cmd">python server/app.py</p>
        ) : (
          <details className="boot-details">
            <summary>技术细节（开发者）</summary>
            <p>本地服务未响应。确认已在项目根目录启动：</p>
            <p className="boot-cmd">python server/app.py</p>
          </details>
        )}
        {onRetry && (
          <button type="button" className="boot-retry" onClick={onRetry}>
            重 试
          </button>
        )}
      </div>
    </div>
  )
}
