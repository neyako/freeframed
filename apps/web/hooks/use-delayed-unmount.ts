import { useEffect, useRef, useState } from 'react'

// Keep a conditionally-rendered element mounted through its close animation.
// Returns `mounted` (true while open OR animating out) and `state`
// ('open' | 'closed') to drive data-[state=*] enter/exit classes. `durationMs`
// must match the exit animation length so unmount lands after it finishes.
export function useDelayedUnmount(open: boolean, durationMs = 150) {
  const [mounted, setMounted] = useState(open)
  const [state, setState] = useState<'open' | 'closed'>(open ? 'open' : 'closed')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (open) {
      // Mount already in the 'open' state. Callers drive keyframe animations
      // (`animate-in`/`animate-out`), which carry their own start values and
      // so need no priming frame. Deferring the flip to rAF instead rendered
      // one frame matching `data-[state=closed]`, firing the *exit* animation
      // backwards on every open — seen as a flash / double-darken of the scrim.
      setMounted(true)
      setState('open')
      return
    }
    setState('closed')
    // Arm the unmount only once the exit animation has actually started. React
    // commits `state='closed'` a frame or two before the browser paints and
    // begins the keyframes, so timing the unmount from commit cut the fade
    // short — measured 129ms of a 150ms animation, popping the element off
    // screen mid-fade with no `animationend`. Two rAFs land us after that
    // first paint; overshooting merely holds a fully-faded element a beat
    // longer, whereas undershooting is the visible glitch.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        timer.current = setTimeout(() => setMounted(false), durationMs)
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [open, durationMs])

  // Drop any pending unmount if the consumer goes away first.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return { mounted, state }
}
