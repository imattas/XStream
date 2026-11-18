import { useEffect, useRef } from 'react'
import type Player from 'xbox-xcloud-player/dist/player'
import Gamepad from 'xbox-xcloud-player/dist/input/gamepad'
import type { InputFrame } from 'xbox-xcloud-player/dist/channel/input/packet'
import type { Preferences } from '../settings/preferences'
import { PadGroups, padStyle } from '../components/PadGroups'
import type { InputMode } from '../../../../input-modes'

function pictureBounds(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect()
  const fit = getComputedStyle(video).objectFit
  if (!video.videoWidth || !video.videoHeight || fit === 'fill') return rect
  const scale = (fit === 'cover' ? Math.max : Math.min)(rect.width / video.videoWidth, rect.height / video.videoHeight)
  const width = video.videoWidth * scale, height = video.videoHeight * scale
  return new DOMRect(rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2, width, height)
}

export default function StreamInput({ player, mode, preferences }: { player: Player; mode: InputMode; preferences: Preferences }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const surface = ref.current!
    const abort = new AbortController()
    const options = { signal: abort.signal }
    const { input, message, control } = player._channels
    const keys = new Map<number, string>()
    let buttons = 0
    let contact: number | undefined
    const padKeys = new Set<string>()
    const virtualBindings: Record<string,string> = { KeyW:'Left', KeyS:'Left', KeyA:'Left', KeyD:'Left',
      ArrowUp:'Right', ArrowDown:'Right', ArrowLeft:'Right', ArrowRight:'Right', KeyJ:'A', KeyK:'B', KeyU:'X', KeyI:'Y' }
    const held = new Map<number, HTMLElement>()
    const fallback = new Gamepad(0).getDefaultFamepadFrame()
    function pad(element: HTMLElement, x = 0, y = 0, pressed = false) {
      const field = element.dataset.button as keyof InputFrame | undefined
      const values: Partial<InputFrame> = field ? { [field]: Number(pressed) } :
        { [element.dataset.stick + 'ThumbXAxis']: x, [element.dataset.stick + 'ThumbYAxis']: y }
      const slot = control.getGamepadHandlers()[0]
      const handler = slot instanceof Gamepad ? slot : undefined
      for (const [key, value] of Object.entries(values)) handler?.sendButtonState(key, value)
      Object.assign(fallback, values)
      input.queueGamepadFrames([handler?.getGamepadState() ?? { ...fallback }], true)
      element.classList.toggle('held', pressed)
      if (!field) {
        element.style.setProperty('--stick-x', x * 62 + '%')
        element.style.setProperty('--stick-y', y * 62 + '%')
      }
    }
    function updatePadKey(target: string) {
      const el = surface.querySelector<HTMLElement>('[data-stick="' + target + '"],[data-button="' + target + '"]')
      if (!el || Array.from(held.values()).includes(el)) return
      const horizontal = target === 'Left' ? ['KeyD','KeyA'] : ['ArrowRight','ArrowLeft']
      const vertical = target === 'Left' ? ['KeyS','KeyW'] : ['ArrowDown','ArrowUp']
      const x = Number(padKeys.has(horizontal[0])) - Number(padKeys.has(horizontal[1]))
      const y = Number(padKeys.has(vertical[0])) - Number(padKeys.has(vertical[1]))
      const length = Math.max(1, Math.hypot(x, y))
      const pressed = Array.from(padKeys).some(code => virtualBindings[code] === target)
      pad(el, x / length, y / length, pressed)
    }
    function overlayKey(event: KeyboardEvent) {
      const target = virtualBindings[event.code]
      if (!target) return
      if (event.type === 'keydown') {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        if (event.repeat || ![document.body,surface].includes(document.activeElement as HTMLElement) && !surface.contains(document.activeElement)) return
        padKeys.add(event.code)
      } else if (!padKeys.delete(event.code)) return
      event.preventDefault()
      updatePadKey(target)
    }
    function mouse(x = 0, y = 0, wheelX = 0, wheelY = 0) {
      input.queueMouseFrame({ X: x, Y: y, WheelX: wheelX, WheelY: wheelY, Buttons: buttons, Relative: 0 })
    }
    function touch(type: string, event?: PointerEvent) {
      const video = surface.parentElement?.querySelector('video')
      if (!video) return
      const rect = pictureBounds(video)
      const x = event?.clientX ?? rect.left, y = event?.clientY ?? rect.top
      if (type === 'pointerdown' && (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom)) return
      input.queuePointerFrame({ events: [{ type, x: Math.max(rect.left, Math.min(rect.right - 1, x)),
        y: Math.max(rect.top, Math.min(rect.bottom - 1, y)), pressure: event?.pressure ?? 0, twist: event?.twist ?? 0,
        target: { getBoundingClientRect: () => rect } }] })
      contact = type === 'pointerup' ? undefined : event?.pointerId
    }
    function reset() {
      for (const [keyCode, key] of keys) input.queueKeyboardFrame({ keyCode, key, pressed: false })
      keys.clear()
      if (buttons) { buttons = 0; mouse() }
      if (contact !== undefined) touch('pointerup')
      for (const element of held.values()) pad(element)
      held.clear()
      const targets = new Set(Array.from(padKeys, code => virtualBindings[code]))
      padKeys.clear()
      for (const target of targets) updatePadKey(target)
    }
    function pointer(event: PointerEvent) {
      const down = event.type === 'pointerdown'
      const end = ['pointerup', 'pointercancel', 'lostpointercapture'].includes(event.type)
      if (mode === 'overlay') {
        const element = down ? (event.target as HTMLElement).closest<HTMLElement>('[data-button],[data-stick]') : held.get(event.pointerId)
        if (!element || (down && Array.from(held.values()).includes(element))) return
        if (down) { surface.focus({ preventScroll: true }); element.setPointerCapture(event.pointerId); held.set(event.pointerId, element) }
        if (end) {
          held.delete(event.pointerId)
          updatePadKey(element.dataset.button || element.dataset.stick!)
          return
        }
        if (element.dataset.stick) {
          const r = element.getBoundingClientRect()
          const x = 2 * (event.clientX - r.left) / r.width - 1, y = 2 * (event.clientY - r.top) / r.height - 1
          const length = Math.max(1, Math.hypot(x, y))
          pad(element, x / length, y / length, true)
        } else if (down) pad(element, 0, 0, true)
      } else if (mode === 'touch') {
        if (event.pointerType !== 'touch' || (down ? contact !== undefined : contact !== event.pointerId)) return
        if (down && surface.hasPointerCapture(event.pointerId) === false && event.isTrusted) surface.setPointerCapture(event.pointerId)
        touch(end ? 'pointerup' : event.type, event)
      } else {
        if (event.pointerType !== 'mouse') return
        if (down) {
          surface.focus()
          if (!document.pointerLockElement) void surface.requestPointerLock?.()?.catch(() => {})
        }
        if (document.activeElement !== surface) return
        buttons = end && event.type !== 'pointerup' ? 0 : event.buttons
        mouse(event.movementX, event.movementY)
      }
      event.preventDefault()
    }
    function key(event: KeyboardEvent) {
      if (mode !== 'kbm' || event.key === 'Escape' || event.key === 'Tab') return
      event.preventDefault()
      const pressed = event.type === 'keydown'
      if (pressed && keys.has(event.keyCode)) return
      if (pressed) keys.set(event.keyCode, event.key)
      else keys.delete(event.keyCode)
      input.queueKeyboardFrame({ key: event.key, keyCode: event.keyCode, pressed })
    }
    const setTouch = (enabled: boolean) => message.send(JSON.stringify(message.generateMessage('/streaming/characteristics/touchinputenabledchanged', { touchInputEnabled: enabled })))
    if (mode === 'touch') setTouch(true)
    for (const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'] as const) surface.addEventListener(type, pointer, options)
    if (mode === 'overlay') {
      window.addEventListener('keydown', overlayKey, options)
      window.addEventListener('keyup', overlayKey, options)
    }
    surface.addEventListener('keydown', key, options)
    surface.addEventListener('keyup', key, options)
    surface.addEventListener('contextmenu', e => e.preventDefault(), options)
    surface.addEventListener('wheel', e => {
      if (mode === 'kbm' && document.activeElement === surface) { e.preventDefault(); mouse(0, 0, e.deltaX, -e.deltaY) }
    }, { ...options, passive: false })
    surface.addEventListener('blur', reset, options)
    window.addEventListener('blur', reset, options)
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) { reset(); surface.blur() } }, options)
    return () => {
      abort.abort()
      reset()
      if (mode === 'touch') setTouch(false)
      if (document.pointerLockElement === surface) document.exitPointerLock()
    }
  }, [player, mode])
  return <div ref={ref} className={'input-surface mode-' + mode} data-mirrored={mode === 'overlay' && preferences.overlayMirrored}
    style={mode === 'overlay' ? padStyle(preferences) : undefined}
    tabIndex={mode === 'touch' ? undefined : 0} aria-label="Game input">
    {mode === 'overlay' && <PadGroups preferences={preferences} />}
  </div>
}
