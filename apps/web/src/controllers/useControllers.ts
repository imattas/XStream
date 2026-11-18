import { useEffect, useState } from 'react'

export interface Controller {
  index: number
  name: string
  mapping: string
  axes: number
  buttons: number
}

export function readGamepads() {
  try {
    return navigator.getGamepads?.()
  } catch {
    return undefined
  }
}

function detected(): Controller[] {
  return Array.from(readGamepads() ?? [])
    .filter((pad): pad is Gamepad => !!pad?.connected)
    .map(pad => ({
      index: pad.index, name: pad.id, mapping: pad.mapping,
      axes: pad.axes.length, buttons: pad.buttons.length,
    }))
}

export function useControllers(enabled: boolean) {
  const [controllers, setControllers] = useState<Controller[]>([])
  useEffect(() => {
    if (!enabled) return
    function sync() {
      if (!document.hidden) setControllers(detected())
    }
    sync()
    window.addEventListener('gamepadconnected', sync)
    window.addEventListener('gamepaddisconnected', sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('gamepadconnected', sync)
      window.removeEventListener('gamepaddisconnected', sync)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [enabled])
  return controllers
}
