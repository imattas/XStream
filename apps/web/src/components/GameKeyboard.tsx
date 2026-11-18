import { useEffect, useRef, useState } from 'react'
import type Player from 'xbox-xcloud-player/dist/player'
import type { KeyboardPrompt } from '../streaming/systemKeyboard'
import { readGamepads } from '../controllers/useControllers'

const letters = ['qwertyuiop','asdfghjkl','zxcvbnm']
const symbols = ['1234567890','@#$%&*-+=','!?:;.,/']

export default function GameKeyboard({ prompt, player }: { prompt: KeyboardPrompt; player?: Player }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(() => prompt.initial.slice(0, prompt.limit))
  const [shift, setShift] = useState(false)
  const [numbers, setNumbers] = useState(false)

  function edit(insert: string, erase = false) {
    const el = input.current!
    const end = el.selectionEnd ?? value.length
    let start = el.selectionStart ?? end
    if (erase && start === end) start -= Array.from(value.slice(0, start)).pop()?.length ?? 0
    const available = (prompt.limit ?? Infinity) - (value.length - end + start)
    const part = insert.slice(0, Math.max(0, available))
    const next = value.slice(0, start) + part + value.slice(end)
    setValue(next)
    requestAnimationFrame(() => el.setSelectionRange(start + part.length, start + part.length))
    if (part && shift) setShift(false)
  }
  function move(dx: number, dy: number) {
    const rows = Array.from(dialog.current!.querySelectorAll('.key-row'), row => Array.from(row.querySelectorAll('button')))
    let y = rows.findIndex(row => row.includes(document.activeElement as HTMLButtonElement))
    if (y < 0) { rows[0][0].focus(); return }
    let x = rows[y].indexOf(document.activeElement as HTMLButtonElement)
    y = Math.max(0, Math.min(rows.length - 1, y + dy))
    x = Math.max(0, Math.min(rows[y].length - 1, x + dx))
    rows[y][x].focus()
  }
  useEffect(() => {
    const modal = dialog.current!
    document.exitPointerLock?.()
    modal.showModal()
    input.current?.focus()
    const pad = player?._channels.control.getGamepadHandlers()[0]
    const handler = pad && 'getGamepadState' in pad ? pad : undefined
    const original = handler?.getGamepadState
    if (handler && player) {
      player._channels.input.queueGamepadFrames([handler.getDefaultFamepadFrame()], true)
      handler.getGamepadState = () => undefined
    }
    let frame = 0
    let previous: boolean[] | undefined
    function poll() {
      const pads = readGamepads()
      if (!pads) return
      const gamepad = Array.from(pads).find(p => p?.connected)
      const now = gamepad?.buttons.map(b => b.pressed || b.value > .5) ?? []
      if (previous) {
        const pressed = (i: number) => now[i] && !previous?.[i]
        if (pressed(1)) prompt.finish()
        else if (pressed(0)) {
          if (document.activeElement instanceof HTMLButtonElement) document.activeElement.click()
          else move(0, 0)
        } else if (pressed(12)) move(0, -1)
        else if (pressed(13)) move(0, 1)
        else if (pressed(14)) move(-1, 0)
        else if (pressed(15)) move(1, 0)
      }
      previous = now
      frame = requestAnimationFrame(poll)
    }
    frame = requestAnimationFrame(poll)
    return () => {
      cancelAnimationFrame(frame)
      if (handler && original) handler.getGamepadState = original
      modal.close()
    }
  }, [prompt, player])

  return <dialog ref={dialog} className="game-keyboard" aria-labelledby="keyboard-title" onCancel={e => { e.preventDefault(); prompt.finish() }}
    onKeyDown={e => {
      if (e.target !== input.current && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault()
        move(Number(e.key === 'ArrowRight') - Number(e.key === 'ArrowLeft'), Number(e.key === 'ArrowDown') - Number(e.key === 'ArrowUp'))
      }
    }}>
    <h2 id="keyboard-title">{prompt.title}</h2>
    {prompt.description && <p>{prompt.description}</p>}
    <input ref={input} aria-label={prompt.title} value={value} type={prompt.secret ? 'password' : 'text'} inputMode="none" autoComplete="off"
      maxLength={prompt.limit} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) prompt.finish(value) }} />
    {(numbers ? symbols : letters).map(row => <div className="key-row" key={row}>{Array.from(shift ? row.toUpperCase() : row, key =>
      <button key={key} onClick={() => edit(key)}>{key}</button>)}</div>)}
    <div className="key-row actions"><button aria-pressed={shift} onClick={() => setShift(!shift)}>Shift</button>
      <button onClick={() => setNumbers(!numbers)}>{numbers ? 'ABC' : '123'}</button><button className="space" onClick={() => edit(' ')}>Space</button>
      <button onClick={() => edit('', true)}>Backspace</button></div>
    <div className="key-row submit"><button onClick={() => prompt.finish()}>Cancel</button><button className="primary" onClick={() => prompt.finish(value)}>Done</button></div>
  </dialog>
}
