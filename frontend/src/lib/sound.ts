/**
 * 音效：全部用 WebAudio 现场合成，不带任何音频文件。
 *
 * 之所以不用素材：一是省掉打包体积和加载态，二是合成音更容易做得「轻」——
 * 这界面里的声音应该是木头的、纸的，而不是电子游戏的。所以走的是
 * 短衰减的正弦 + 一点噪声，模仿落子的实木声。
 */

type Voice = 'move' | 'capture' | 'check' | 'ready' | 'win' | 'lose'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
let noiseBuffer: AudioBuffer | null = null

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer
  const len = Math.floor(c.sampleRate * 0.12)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  }
  noiseBuffer = buf
  return buf
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

function click(c: AudioContext, freq: number, gain: number, duration: number, q: number) {
  const src = c.createBufferSource()
  src.buffer = noise(c)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(gain, c.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration)
  src.connect(filter)
  filter.connect(g)
  g.connect(master!)
  src.start(c.currentTime)
}

const RECIPES: Record<Voice, (c: AudioContext) => void> = {
  move: (c) => {
    click(c, 1450, 0.22, 0.07, 6)
    tone(c, 320, 0.09, 0.06, 'triangle')
  },
  capture: (c) => {
    click(c, 620, 0.34, 0.13, 3)
    tone(c, 150, 0.2, 0.12, 'sine')
    tone(c, 226, 0.14, 0.05, 'triangle')
  },
  check: (c) => {
    tone(c, 880, 0.5, 0.13, 'sine')
    tone(c, 1320, 0.42, 0.07, 'sine')
    tone(c, 1760, 0.3, 0.035, 'sine')
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
  if (master) master.gain.value = value ? 0.5 : 0
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
