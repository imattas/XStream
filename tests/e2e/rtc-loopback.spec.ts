import { expect, test, type JSHandle } from '@playwright/test'

interface Peer {
  pc: RTCPeerConnection
  candidates: RTCIceCandidateInit[]
  answer: string
  keyboardReply?: string
  messageChannel?: RTCDataChannel
  keyboardEnabled?: boolean
  controllerRegistered?: boolean
  flags: number
  leftY?: number
  inputs: number
}

for (const scenario of ['xhome', 'xcloud', 'seven-day expiry']) test(scenario + ' plays loopback audio and video through the production player and sends controller reports', async ({ page }) => {
  const expiresDuringPlay = scenario === 'seven-day expiry'
  const mode = scenario === 'xcloud' ? 'xcloud' : 'xhome'
  const start = Date.now(), week = 7 * 24 * 3600_000
  if (expiresDuringPlay) await page.clock.install({ time: new Date(start) })
  let peer: JSHandle<Peer> | undefined
  let disconnected = false
  let transferred = false
  let queued = mode === 'xcloud'
  await page.addInitScript((touch: boolean) => {
    if (touch) Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 })
    localStorage.setItem('xstream.preferences.v1', JSON.stringify({ overlayScale: 85, overlayOpacity: 60, overlayMirrored: true }))
    const fixture = { index: 0, connected: true, id: 'Test Xbox controller', mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ value: i === 0 ? 1 : 0 })) }
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
      if (touch) throw new DOMException('Gamepads unavailable', 'SecurityError')
      return [fixture]
    } })
  }, mode === 'xcloud')
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const reply = (json: unknown) => route.fulfill({ json })
    if (path === '/api/auth/session') return reply({ authenticated: true, expiresAt: start + week, serverTime: await page.evaluate(() => Date.now()) })
    if (path === '/api/consoles') return reply({ consoles: [] })
    if (path === (mode === 'xcloud' ? '/api/cloud/session' : '/api/stream/session')) return reply({ sessionId: 'loopback', inputs: mode === 'xcloud' ? ['controller','overlay','kbm','touch'] : undefined })
    if (path === '/api/cloud/waittime') return reply({ seconds: 120 })
    if (path.endsWith('/state') && queued) { queued = false; return reply({ state: 'WaitingForResources' }) }
    if (path.endsWith('/state')) return reply({ state: transferred ? 'Provisioned' : 'ReadyToConnect' })
    if (path.endsWith('/connect')) { transferred = true; return reply({ accepted: true }) }
    if (path.endsWith('/sdp') && request.method() === 'POST') {
      peer = await page.evaluateHandle(async (sdp: string) => {
        const pc = new RTCPeerConnection()
        const result: Peer = { pc, candidates: [], answer: '', inputs: 0, flags: 0 }
        pc.onicecandidate = ({ candidate }) => { if (candidate) result.candidates.push(candidate.toJSON()) }
        pc.ondatachannel = ({ channel }) => {
          channel.binaryType = 'arraybuffer'
          channel.onmessage = ({ data }) => {
            if (channel.label === 'control') {
              const message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
              if (message.message === 'gamepadChanged' && message.gamepadIndex === 0) result.controllerRegistered = message.wasAdded
            }
            if (channel.label === 'message') {
              const message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
              result.messageChannel = channel
              if (message.target === '/streaming/systemUi/configuration') result.keyboardEnabled = JSON.parse(message.content).systemUis.includes(10)
              if (message.id === 'keyboard-test') result.keyboardReply = message.type === 'ReceiverCancel' ? 'cancelled' : JSON.parse(message.content).Text
              if (message.type === 'Handshake') channel.send(JSON.stringify({ type: 'HandshakeAck' }))
            }
            if (channel.label === 'input' && data instanceof ArrayBuffer) {
              const reportType = new DataView(data).getUint16(0, true)
              result.flags |= reportType
              if ((reportType & 2) !== 0) {
                result.inputs++
                const packet = new DataView(data)
                const offset = 14 + (reportType & 1 ? 1 + 28 * packet.getUint8(14) : 0)
                const lastFrame = offset + 1 + (packet.getUint8(offset) - 1) * 23
                result.leftY = packet.getInt16(lastFrame + 5, true)
              }
            }
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = 180
        const ctx = canvas.getContext('2d')!
        const timer = setInterval(() => { ctx.fillStyle = 'green'; ctx.fillRect(0, 0, 320, 180) }, 60)
        const stream = canvas.captureStream(15)
        pc.addTrack(stream.getVideoTracks()[0], stream)
        const audio = new AudioContext()
        const destination = audio.createMediaStreamDestination()
        const tone = audio.createOscillator()
        const gain = audio.createGain()
        gain.gain.value = 0.01
        tone.connect(gain).connect(destination)
        tone.start()
        await audio.resume()
        pc.addTrack(destination.stream.getAudioTracks()[0], destination.stream)
        pc.onconnectionstatechange = () => {
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
            clearInterval(timer)
            stream.getTracks().forEach(track => track.stop())
            destination.stream.getTracks().forEach(track => track.stop())
            void audio.close()
          }
        }
        await pc.setRemoteDescription({ type: 'offer', sdp })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        result.answer = answer.sdp!
        return result
      }, request.postDataJSON().sdp)
      return reply({ accepted: true })
    }
    if (path.endsWith('/sdp') && peer) return reply({ sdp: await peer.evaluate(p => p.answer) })
    if (path.endsWith('/ice') && peer) {
      if (request.method() === 'POST') {
        await peer.evaluate(async (p, candidates: RTCIceCandidateInit[]) => {
          for (const candidate of candidates) await p.pc.addIceCandidate(candidate)
        }, request.postDataJSON().candidates)
        return reply({ accepted: true })
      }
      const candidates = await peer.evaluate(p => p.candidates)
      return reply(candidates.length ? { candidates } : { pending: true })
    }
    if (request.method() === 'DELETE') disconnected = true
    return reply({ accepted: true })
  })
  await page.goto(mode === 'xcloud' ? '/stream/cloud/game-a' : '/stream/console-a')
  if (mode === 'xcloud') await expect(page.getByText(/In the Xbox queue.*2 min remaining/)).toBeVisible()
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 20000 })
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).videoWidth)).toBe(320)
  if (mode === 'xhome') await expect.poll(() => peer!.evaluate(p => p.inputs)).toBeGreaterThan(0)
  await expect.poll(() => peer!.evaluate(p => p.controllerRegistered)).toBe(true)
  await expect.poll(() => peer!.evaluate(p => p.keyboardEnabled)).toBe(true)
  const openKeyboard = () => peer!.evaluate(p => p.messageChannel!.send(JSON.stringify({ type: 'TransactionStart',
    target: '/streaming/systemUi/messages/ShowVirtualKeyboard', id: 'keyboard-test', content: JSON.stringify({ TitleText: 'Name your pilot', DefaultText: 'Ace', MaxLength: 4 }) })))
  await openKeyboard()
  const keyboard = page.getByRole('dialog', { name: 'Name your pilot' })
  await expect(keyboard).toBeVisible()
  await keyboard.getByRole('button', { name: 'Shift' }).click()
  await keyboard.getByRole('button', { name: 'X', exact: true }).click()
  await expect(keyboard.getByRole('textbox')).toHaveValue('AceX')
  await keyboard.getByRole('button', { name: 'Done' }).click()
  await expect.poll(() => peer!.evaluate(p => p.keyboardReply)).toBe('AceX')
  await openKeyboard()
  await keyboard.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => peer!.evaluate(p => p.keyboardReply)).toBe('cancelled')
  const selector = page.getByLabel('Stream input')
  await expect(selector).toHaveValue(mode === 'xcloud' ? 'touch' : 'controller')
  if (mode === 'xcloud') {
    await expect(selector.locator('option[value=controller]')).toHaveCount(0)
    await expect(selector).toHaveValue('touch')
    await expect(page.locator('.pad-stick')).toHaveCount(0)
    await selector.selectOption('overlay')
  } else {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'getGamepads', { value: () => [] })
      window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), {gamepad: {index: 0}}))
    })
    await expect(selector).toHaveValue('overlay')
  }
  await page.locator('.mode-overlay').focus()
  await page.keyboard.down('w')
  await expect(page.getByRole('button', {name: 'Left stick'})).toHaveClass(/held/)
  await expect.poll(() => peer!.evaluate(p => p.leftY)).toBeGreaterThan(30000)
  await page.keyboard.down('Control')
  await page.keyboard.up('w')
  await page.keyboard.up('Control')
  await expect.poll(() => peer!.evaluate(p => p.leftY)).toBe(0)
  await expect(page.getByRole('button', {name: 'Left stick'})).not.toHaveClass(/held/)
  const stick = (await page.getByRole('button', {name:'Left stick'}).boundingBox())!
  await page.mouse.move(stick.x + stick.width / 2, stick.y + stick.height / 2)
  await page.mouse.down()
  await page.mouse.move(stick.x + stick.width / 2, stick.y + stick.height * .08)
  await expect.poll(() => peer!.evaluate(p => p.leftY)).toBeGreaterThan(20000)
  await page.mouse.up()
  await expect.poll(() => peer!.evaluate(p => p.leftY)).toBe(0)
  await expect(page.locator('.mode-overlay')).toHaveCSS('opacity', '0.6')
  await expect(page.locator('.pad-0')).toHaveCSS('scale', '0.85')
  const leftGroup = await page.locator('.pad-0').boundingBox()
  const rightGroup = await page.locator('.pad-2').boundingBox()
  expect(leftGroup!.x).toBeGreaterThan(rightGroup!.x)
  await page.getByRole('button', { name: 'RightThumb', exact: true }).click()
  if (mode === 'xcloud') {
    await selector.selectOption('kbm')
    const surface = page.locator('.input-surface')
    await surface.click()
    await page.keyboard.press('w')
    await expect.poll(() => peer!.evaluate(p => p.flags & 96)).toBe(96)
    await page.evaluate(() => document.exitPointerLock())
    await selector.selectOption('touch')
    const box = (await surface.boundingBox())!
    await surface.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 8, clientX: box.width / 2, clientY: box.height / 2 })
    await surface.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 8 })
    await expect.poll(() => peer!.evaluate(p => p.flags & 4)).toBe(4)
  } else await expect(selector.locator('option')).toHaveCount(2)
  await page.getByRole('button', { name: 'Resume playback' }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Statistics' }).click()
  await expect(page.getByText('320 × 180')).toBeVisible()
  await expect(page.getByText(/^\d+\.\d{2} Mbps$/)).toBeVisible()
  if (expiresDuringPlay) {
    const tracks = await page.locator('video').evaluateHandle(video => ((video as HTMLVideoElement).srcObject as MediaStream).getTracks())
    await page.clock.fastForward(week)
    await expect(page.getByRole('heading', { name:'Link your Microsoft account' })).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)
    expect(await tracks.evaluate(list => list.every(track => track.readyState === 'ended'))).toBe(true)
    return
  }
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page).toHaveURL(mode === 'xcloud' ? /\/cloud$/ : /\/home$/)
  expect(disconnected).toBe(true)
})

