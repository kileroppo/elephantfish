import { useState } from 'react'
import type { GameSnapshot, EngineInfo } from '../types'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'

export interface TopBarProps {
  game?: GameSnapshot
  engineInfo?: EngineInfo
  connected?: boolean
  flipped?: boolean
  soundOn?: boolean
  setupMode?: boolean
  drillMode?: boolean
  theme?: 'xuan' | 'wumu'
  zenMode?: boolean
  onToggleZen?: () => void
  onCycleTheme?: () => void
  onToggleSetup?: () => void
  onToggleDrill?: () => void
  onToggleEngine?: () => void
  onToggleEngineSide?: () => void
  onFlip?: () => void
  onToggleSound?: () => void
  onHelp?: () => void
  onRefresh?: () => void
  playMode?: 'sparring' | 'relay'
  shadowGuess?: boolean
  onTogglePlayMode?: () => void
  onToggleShadowGuess?: () => void
}

export function TopBar(props: TopBarProps) {
  const g = useGameContext()
  const ui = useUIContext()

  const game = props.game ?? g.state?.game
  if (!game) return null

  const engineInfo = props.engineInfo ?? g.state?.engine_info
  const connected = props.connected ?? g.connected
  const soundOn = props.soundOn ?? ui.soundOn
  const setupMode = props.setupMode ?? false
  const drillMode = props.drillMode ?? ui.drillOpen
  const theme = props.theme ?? ui.theme
  const zenMode = props.zenMode ?? ui.zenMode
  const onToggleZen = props.onToggleZen ?? ui.toggleZen
  const onCycleTheme = props.onCycleTheme ?? ui.cycleTheme
  const onToggleSetup = props.onToggleSetup
  const onToggleDrill =
    props.onToggleDrill ??
    (() => {
      if (ui.drillOpen) ui.closeDrill()
      else ui.openDrillAt()
    })
  const onToggleEngine =
    props.onToggleEngine ??
    (() => {
      const current = g.state?.settings.engine_type ?? 'pikafish'
      const next = current === 'pikafish' ? 'builtin' : 'pikafish'
      void g.updateSettings({ engine_type: next })
    })
  const onToggleEngineSide = props.onToggleEngineSide
  const onFlip = props.onFlip ?? ui.turnBoard
  const onToggleSound = props.onToggleSound ?? ui.toggleSound
  const onHelp = props.onHelp ?? (() => ui.setHelp(true))
  const onRefresh = props.onRefresh ?? (() => void g.refresh())
  const playMode = props.playMode ?? ui.playMode
  const shadowGuess = props.shadowGuess ?? ui.shadowGuess
  const onTogglePlayMode = props.onTogglePlayMode ?? ui.togglePlayMode
  const onToggleShadowGuess = props.onToggleShadowGuess ?? ui.toggleShadowGuess
  const isPikafish = engineInfo?.active === 'pikafish'
  const isEngineRed = game.engine_side === 'red'
  const [menu, setMenu] = useState(false)
  const close = (fn?: () => void) => () => {
    setMenu(false)
    fn?.()
  }

  return (
    <header className={`topbar${menu ? ' is-menu-open' : ''}`}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          象
        </span>
        <div className="brand-text">
          <h1>XQ-Coach</h1>
          <p>象棋教练实训台</p>
        </div>
      </div>

      {/* 引擎 · 执方 · 材质：三个纯文字开关，中点分隔，不再是三颗彩色胶囊 */}
      <div className="topbar-setting" role="group" aria-label="对局设定">
        {engineInfo && (
          <button
            key={engineInfo.active}
            type="button"
            className="setting-link"
            onClick={onToggleEngine}
            title={
              isPikafish
                ? '当前引擎：皮卡鱼 Pikafish (NNUE)，点击切换为内置纯 Python 引擎'
                : '当前引擎：内置纯 Python，点击切换为皮卡鱼 Pikafish NNUE'
            }
          >
            {isPikafish ? '皮卡鱼' : '纯 Python'}
          </button>
        )}
        <span className="setting-dot" aria-hidden="true">·</span>
        <button
          key={game.engine_side}
          type="button"
          className={`setting-link side-${game.engine_side}`}
          onClick={onToggleEngineSide}
          title={isEngineRed ? '引擎执红，点击切换为执黑' : '引擎执黑，点击切换为执红'}
          aria-label={`切换执子方，当前引擎执${isEngineRed ? '红' : '黑'}`}
        >
          引擎执{isEngineRed ? '红' : '黑'}
        </button>
        {onCycleTheme && (
          <>
            <span className="setting-dot" aria-hidden="true">·</span>
            <button
              type="button"
              className="setting-link"
              onClick={onCycleTheme}
              title="切换材质 (快捷键 T)"
              aria-label="切换主题"
            >
              {theme === 'wumu' ? '乌墨' : '宣纸'}
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        className="topbar-menu-btn"
        aria-expanded={menu}
        aria-label="菜单"
        onClick={() => setMenu((v) => !v)}
      >
        ≡
      </button>

      <nav className="topbar-actions" aria-label="功能">
        {onTogglePlayMode && (
          <button
            type="button"
            className={`icon-btn${playMode === 'relay' ? ' is-on' : ''}`}
            onClick={close(onTogglePlayMode)}
            title={playMode === 'relay' ? '当前：信使转述模式（点击切换为实战陪练）' : '当前：实战陪练模式（点击切换为信使代打）'}
          >
            {playMode === 'relay' ? '信使代打' : '实战陪练'}
          </button>
        )}
        {playMode === 'relay' && onToggleShadowGuess && (
          <button
            type="button"
            className={`icon-btn${shadowGuess ? ' is-on' : ''}`}
            onClick={close(onToggleShadowGuess)}
            title={shadowGuess ? '跟师盲猜已开启' : '点击开启跟师盲猜'}
          >
            盲猜{shadowGuess ? '·开' : '·关'}
          </button>
        )}
        {!connected && (
          <button type="button" className="icon-btn warn" onClick={close(onRefresh)} title="服务未连接，点击重试">
            断线重连
          </button>
        )}
        {onToggleZen && (
          <button
            type="button"
            className={`icon-btn${zenMode ? ' is-on' : ''}`}
            onClick={close(onToggleZen)}
            title={zenMode ? '退出专注 (Z / Esc)' : '专注模式 (Z)'}
            aria-pressed={zenMode}
          >
            {zenMode ? '退出专注' : '专注'}
          </button>
        )}
        <button
          type="button"
          className={`icon-btn${drillMode ? ' is-on' : ''}`}
          onClick={close(onToggleDrill)}
          title={drillMode ? '退出精训营' : '进入精训营'}
        >
          {drillMode ? '退出精训' : '精训营'}
        </button>
        <button
          type="button"
          className={`icon-btn${setupMode ? ' is-on' : ''}`}
          onClick={close(onToggleSetup)}
          title={setupMode ? '退出补棋模式' : '进入补棋模式（自定义排局）'}
        >
          {setupMode ? '退出补棋' : '补棋'}
        </button>
        <button type="button" className="icon-btn" onClick={close(onFlip)} title="翻转视角 (F)">
          翻转
        </button>
        <button
          type="button"
          className={`icon-btn${soundOn ? ' is-on' : ''}`}
          onClick={close(onToggleSound)}
          title={soundOn ? '静音' : '开启音效'}
          aria-pressed={soundOn}
        >
          {soundOn ? '音效' : '静音'}
        </button>
        <button type="button" className="icon-btn" onClick={close(onHelp)} title="快捷键帮助 (?)">
          帮助
        </button>
      </nav>
    </header>
  )
}
