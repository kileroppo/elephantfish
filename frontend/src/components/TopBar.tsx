import type { GameSnapshot, EngineInfo } from '../types'

interface Props {
  game: GameSnapshot
  engineInfo?: EngineInfo
  connected: boolean
  flipped: boolean
  soundOn: boolean
  setupMode?: boolean
  drillMode?: boolean
  onToggleSetup?: () => void
  onToggleDrill?: () => void
  onToggleEngine?: () => void
  onToggleEngineSide?: () => void
  onFlip: () => void
  onToggleSound: () => void
  onHelp: () => void
  onRefresh: () => void
}

export function TopBar({
  game,
  engineInfo,
  connected,
  soundOn,
  setupMode = false,
  drillMode = false,
  onToggleSetup,
  onToggleDrill,
  onToggleEngine,
  onToggleEngineSide,
  onFlip,
  onToggleSound,
  onHelp,
  onRefresh,
}: Props) {
  const isPikafish = engineInfo?.active === 'pikafish'
  const isEngineRed = game.engine_side === 'red'

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="30" height="30">
            <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="20" cy="20" r="12.5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
            <text
              x="20"
              y="21.5"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="19"
              fill="currentColor"
            >
              象
            </text>
          </svg>
        </span>
        <div className="brand-text">
          <h1>Elephantfish</h1>
        </div>
        {engineInfo && (
          <button
            key={engineInfo.active}
            type="button"
            className={`engine-badge is-clickable${isPikafish ? ' is-pikafish' : ''}`}
            onClick={onToggleEngine}
            title={
              isPikafish
                ? `当前引擎：皮卡鱼 Pikafish (NNUE 神经网络)\n点击切换为内置纯 Python 引擎`
                : '当前引擎：内置纯 Python 引擎\n点击切换为皮卡鱼 Pikafish NNUE'
            }
          >
            <span className="engine-badge-icon" aria-hidden="true">
              {isPikafish ? '⚡' : '🐘'}
            </span>
            <span className="engine-badge-name">
              {isPikafish ? '皮卡鱼 NNUE' : '纯 Python'}
            </span>
            <span className="engine-badge-switch" aria-hidden="true">
              ⇄
            </span>
          </button>
        )}

        <button
          key={game.engine_side}
          type="button"
          className={`engine-side-badge is-clickable side-${game.engine_side}`}
          onClick={onToggleEngineSide}
          title={
            isEngineRed
              ? '当前：引擎执红（红方朝下）\n点击切换为引擎执黑'
              : '当前：引擎执黑（黑方朝下）\n点击切换为引擎执红'
          }
          aria-label={`切换执子方，当前引擎执${isEngineRed ? '红' : '黑'}`}
        >
          <span className={`engine-side-disc side-${game.engine_side}`} aria-hidden="true">
            {isEngineRed ? '帅' : '将'}
          </span>
          <span className="engine-side-name">
            引擎执{isEngineRed ? '红' : '黑'}
          </span>
          <span className="engine-side-switch" aria-hidden="true">
            ⇄
          </span>
        </button>
      </div>

      <div className="topbar-actions">
        {!connected && (
          <button type="button" className="icon-btn warn" onClick={onRefresh} title="服务未连接，点击重试">
            <span className="warn-dot" aria-hidden="true" />
            断线
          </button>
        )}
        <button
          type="button"
          className={`icon-btn icon-drill${drillMode ? ' is-on' : ''}`}
          onClick={onToggleDrill}
          title={drillMode ? '退出精训营，返回转述对局' : '进入精训营（专项题库、实战攻坚与棋力精训）'}
        >
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="10" cy="10" r="7" />
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 2v2M10 16v2M2 10h2M16 10h2" />
          </svg>
          <span>{drillMode ? '退出实训' : '精训营'}</span>
        </button>
        <button
          type="button"
          className={`icon-btn icon-setup${setupMode ? ' is-on' : ''}`}
          onClick={onToggleSetup}
          title={setupMode ? '退出补棋模式' : '进入补棋模式（自定义排局）'}
        >
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="3" width="14" height="14" rx="2" />
            <path d="M3 10h14M10 3v14" />
          </svg>
          <span>{setupMode ? '退出补棋' : '补棋模式'}</span>
        </button>
        <button type="button" className="icon-btn icon-flip" onClick={onFlip} title="翻转视角 (快捷键 F)">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 7a6 6 0 0 1 10-3.5M16 13a6 6 0 0 1-10 3.5" />
            <path d="M14 1v3h-3M6 19v-3h3" strokeLinecap="round" />
          </svg>
          <span>翻转</span>
        </button>
        <button
          type="button"
          className={`icon-btn icon-sound${soundOn ? ' is-on' : ''}`}
          onClick={onToggleSound}
          title={soundOn ? '静音' : '开启音效'}
          aria-pressed={soundOn}
        >
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 7.5h2.8L10 4.5v11l-3.7-3H3.5z" />
            <path className="sound-wave w1" d="M12.8 8a2.8 2.8 0 0 1 0 4" />
            <path className="sound-wave w2" d="M15 5.8a6 6 0 0 1 0 8.4" />
            <path className="sound-mute" d="m13 8 4 4m0-4-4 4" />
          </svg>
          <span>{soundOn ? '音效' : '静音'}</span>
        </button>
        <button type="button" className="icon-btn" onClick={onHelp} title="快捷键帮助 (?)">
          ?
        </button>
      </div>
    </header>
  )
}
