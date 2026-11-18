import type Player from 'xbox-xcloud-player/dist/player'

export interface KeyboardPrompt {
  id: string
  title: string
  description: string
  initial: string
  limit?: number
  secret: boolean
  finish(text?: string): void
}

export function enableSystemKeyboard(player: Player, show: (prompt?: KeyboardPrompt) => void) {
  const channel = player._channels.message
  let current: KeyboardPrompt | undefined
  channel.onSystemKeyboardMessage = msg => {
    if (msg.type === 'SenderCancel' && current && msg.id === current.id) {
      current = undefined
      show()
      return true
    }
    if (msg.type !== 'TransactionStart' || msg.target !== '/streaming/systemUi/messages/ShowVirtualKeyboard') return false
    if (current?.id === msg.id) return true
    current?.finish()
    let data
    try { data = JSON.parse(msg.content || '{}') } catch { data = {} }
    const field = (key: string) => typeof data?.[key] === 'string' ? data[key] as string : ''
    const prompt: KeyboardPrompt = {
      id: msg.id, title: field('TitleText') || 'Enter text', description: field('DescriptionText'), initial: field('DefaultText'),
      limit: Number.isSafeInteger(data?.MaxLength) && data.MaxLength > 0 ? data.MaxLength : undefined,
      secret: data?.InputScope === 31 || data?.InputScope === 63,
      finish(text) {
        if (current !== prompt) return
        current = undefined
        channel.send(JSON.stringify({ type: text === undefined ? 'ReceiverCancel' : 'TransactionComplete',
          content: JSON.stringify(text === undefined ? '' : { Text: text }), id: msg.id, cv: '' }))
        show()
      },
    }
    current = prompt
    show(prompt)
    return true
  }
}
