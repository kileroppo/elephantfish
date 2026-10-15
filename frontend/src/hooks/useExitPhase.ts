import { useEffect, useRef, useState } from 'react'

/**
 * 给「关掉就卸载」的弹层补上退场那一段。
 *
 * 为什么值得单写一个钩子：React 里条件渲染的弹层，状态一转 false 那一帧组件就从
 * DOM 上摘掉了 —— CSS 里退场动画写得再漂亮也来不及播。于是「关」永远是一刀切，
 * 而入场是有编舞的，开与关的手法不对等，手感立刻掉一个档次。
 *
 * 做法：关掉之后组件多活 `exitMs`，期间挂 `is-leaving` 让退场动画播完，再真正卸载。
 * 返回 `[mounted, leaving]`：`mounted` 决定要不要渲染，`leaving` 决定挂不挂那个类。
 *
 * 两个容易踩的点：
 * - **重开要能打断退场**。用户在 180ms 内又把弹层叫回来（连按快捷键很常见），
 *   必须立刻清掉 leaving 与待卸载的定时器，否则它会在半路自己消失。
 * - **卸载后不再动状态**。定时器在清理函数里必须清掉，不然组件已卸载还 setState。
 */
export function useExitPhase(open: boolean, exitMs = 180): [boolean, boolean] {
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (open) {
      setLeaving(false)
      setMounted(true)
      return
    }
    if (!mounted) return
    setLeaving(true)
    timer.current = window.setTimeout(() => {
      setLeaving(false)
      setMounted(false)
      timer.current = null
    }, exitMs)
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [open, exitMs, mounted])

  return [mounted, leaving]
}
