/**
 * 音效：硬木物理声学建模纯合成（Web Audio API）。
 *
 * 物理声学原理：
 * 1. 瞬态撞击裂音（Transient Clack）：硬木表面碰撞时 0~15ms 的高频脆裂冲击（1.8k~2.2kHz 高 Q 带通）。
 * 2. 棋子木体共鸣（Body Resonance）：实心木质棋子固有振荡频率（480~520Hz，伴随接触阻尼滑音）。
 * 3. 棋盘实木板腔（Board Cavity Thud）：厚实木制棋盘台面的低频回响（180~210Hz，赋予沉实分量）。
 * 4. 自然微抖动（Micro-variation）：每次落子随机 ±3% 音高与相位偏移，真实不机械。
 * 5. 吃子双碰撞（Double-impact）：攻击子砸落 + 被吃子侧向被撞弹开的双重硬木脆裂音。
 */

type Voice = 'move' | 'capture' | 'check' | 'ready' | 'win' | 'lose'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
let noiseBuffer: AudioBuffer | null = null

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.55
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer
  const len = Math.floor(c.sampleRate * 0.15)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i += 1) {
    // 指数型白噪声衰减，模拟击打瞬态材质碰撞
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8)
  }
  noiseBuffer = buf
  return buf
}

/**
 * 硬木撞击物理建模声音合成器
 */
function woodStrike(
  c: AudioContext,
  time: number,
  options: {
    gainScale?: number
    pitchScale?: number
    isSecondary?: boolean
  } = {},
) {
  const { gainScale = 1, pitchScale = 1, isSecondary = false } = options

  // ±3% 自然微随机，避免千篇一律的机械感
  const jitter = 1 + (Math.random() - 0.5) * 0.06
  const p = pitchScale * jitter

  // 1. 瞬态硬木碰击裂音（Transient Clack）- 高Q带通滤波
  const noiseSource = c.createBufferSource()
  noiseSource.buffer = noise(c)
  const bandpass = c.createBiquadFilter()
  bandpass.type = 'bandpass'
  bandpass.frequency.setValueAtTime((isSecondary ? 2250 : 1850) * p, time)
  bandpass.Q.setValueAtTime(isSecondary ? 8 : 11, time)

  const noiseGain = c.createGain()
  noiseGain.gain.setValueAtTime(0.42 * gainScale, time)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + (isSecondary ? 0.022 : 0.038))

  noiseSource.connect(bandpass)
  bandpass.connect(noiseGain)
  noiseGain.connect(master!)
  noiseSource.start(time)
  noiseSource.stop(time + 0.05)

  // 2. 棋子木质本体共鸣（Body Resonance）- 480Hz ~ 520Hz，带阻尼微下潜
  const bodyOsc = c.createOscillator()
  bodyOsc.type = 'triangle'
  bodyOsc.frequency.setValueAtTime(510 * p, time)
  bodyOsc.frequency.exponentialRampToValueAtTime(310 * p, time + 0.032)

  const bodyGain = c.createGain()
  bodyGain.gain.setValueAtTime(0.32 * gainScale, time)
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045)

  bodyOsc.connect(bodyGain)
  bodyGain.connect(master!)
  bodyOsc.start(time)
  bodyOsc.stop(time + 0.055)

  // 3. 棋盘厚实木腔余鸣（Board Cavity Thud）- 180Hz ~ 210Hz
  if (!isSecondary) {
    const cavityOsc = c.createOscillator()
    cavityOsc.type = 'sine'
    cavityOsc.frequency.setValueAtTime(195 * p, time)
    cavityOsc.frequency.exponentialRampToValueAtTime(135 * p, time + 0.065)

    const cavityGain = c.createGain()
    cavityGain.gain.setValueAtTime(0.36 * gainScale, time)
    cavityGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.085)

    cavityOsc.connect(cavityGain)
    cavityGain.connect(master!)
    cavityOsc.start(time)
    cavityOsc.stop(time + 0.095)
  }
}

function tone(
  c: AudioContext,
  freq: number,
  duration: number,
  gain: number,
  type: OscillatorType = 'sine',
  detune = 0,
) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  osc.detune.value = detune
  g.gain.setValueAtTime(0, c.currentTime)
  g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration)
  osc.connect(g)
  g.connect(master!)
  osc.start(c.currentTime)
  osc.stop(c.currentTime + duration + 0.02)
}

const RECIPES: Record<Voice, (c: AudioContext) => void> = {
  // 普通走子：一次清脆沉实的硬木触板敲击
  move: (c) => {
    woodStrike(c, c.currentTime, { gainScale: 1.0, pitchScale: 1.0 })
  },
  // 吃子：重击初碰 + 被击子侧弹微延迟双重碰撞（Double-impact）
  capture: (c) => {
    woodStrike(c, c.currentTime, { gainScale: 1.25, pitchScale: 0.94 })
    // 20ms 后受力棋子被撞击弹移声
    woodStrike(c, c.currentTime + 0.02, {
      gainScale: 0.78,
      pitchScale: 1.28,
      isSecondary: true,
    })
  },
  // 将军：清亮木铎鸣响
  check: (c) => {
    woodStrike(c, c.currentTime, { gainScale: 0.9, pitchScale: 1.15 })
    tone(c, 880, 0.15, 0.16, 'sine')
    window.setTimeout(() => tone(c, 1320, 0.18, 0.12, 'sine'), 40)
  },
  ready: (c) => {
    tone(c, 660, 0.18, 0.07, 'sine')
    window.setTimeout(() => tone(c, 990, 0.22, 0.06, 'sine'), 90)
  },
  win: (c) => {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      window.setTimeout(() => tone(c, f, 0.5, 0.085, 'sine'), i * 110)
    })
  },
  lose: (c) => {
    ;[392, 329.63, 261.63].forEach((f, i) => {
      window.setTimeout(() => tone(c, f, 0.6, 0.085, 'triangle'), i * 140)
    })
  },
}

export function setSoundEnabled(value: boolean) {
  enabled = value
  if (master) master.gain.value = value ? 0.55 : 0
}

export function isSoundEnabled() {
  return enabled
}

export function play(voice: Voice) {
  if (!enabled) return
  try {
    const c = ensure()
    if (!c) return
    RECIPES[voice](c)
  } catch {
    /* 声音失败不影响下棋 */
  }
}

/** 首次用户交互时解锁音频上下文（浏览器自动播放策略）。 */
export function unlockAudio() {
  ensure()
}
