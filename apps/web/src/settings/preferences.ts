import type { InputMode } from '../../../../input-modes'
import { useState } from 'react'

export type Fit = 'contain' | 'cover' | 'fill'
export interface Preferences {
  catalogSort: 'recommended' | 'az' | 'za' | 'last'
  accent: 'green' | 'blue' | 'violet'
  startStats: boolean
  preferredInput: 'auto' | InputMode
  overlayScale: number
  overlayOpacity: number
  overlayMirrored: boolean
  background: 'classic' | 'aurora' | 'midnight'
  startPage: 'home' | 'cloud'
  overlayInset: number
  overlayLift: [number, number, number]
  fit: Fit
  relay: boolean
  bitrateKbps: number
  deadzone: number
  swapAB: boolean
  autoReconnect: boolean
}
const key = 'xstream.preferences.v1'
const legacyKey = 'greenlight.preferences.v1'
const defaults: Preferences = {
  catalogSort: 'recommended', accent: 'green', startStats: false, preferredInput: 'auto',
  overlayScale: 100, overlayOpacity: 100, overlayMirrored: false, background: 'classic', startPage: 'home', overlayInset: 2, overlayLift: [2, 2, 2],
  fit: 'contain', relay: false, bitrateKbps: 0, deadzone: 0.1, swapAB: false, autoReconnect: true,
}

function within(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

function read(): Preferences {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? localStorage.getItem(legacyKey) ?? '{}') as Partial<Preferences>
    return {
      catalogSort: data.catalogSort === 'az' || data.catalogSort === 'za' || data.catalogSort === 'last' ? data.catalogSort : 'recommended',
      accent: data.accent === 'blue' || data.accent === 'violet' ? data.accent : 'green',
      startStats: data.startStats === true,
      preferredInput: data.preferredInput === 'controller' || data.preferredInput === 'kbm' || data.preferredInput === 'touch' || data.preferredInput === 'overlay' ? data.preferredInput : 'auto',
      overlayScale: within(data.overlayScale, 75, 115, defaults.overlayScale),
      overlayOpacity: within(data.overlayOpacity, 35, 100, defaults.overlayOpacity),
      overlayMirrored: data.overlayMirrored === true,
      background: data.background === 'aurora' || data.background === 'midnight' ? data.background : 'classic',
      startPage: data.startPage === 'cloud' ? 'cloud' : 'home',
      overlayInset: within(data.overlayInset, 0, 8, 2),
      overlayLift: [0, 1, 2].map(i => within(data.overlayLift?.[i], 0, 30, 2)) as Preferences['overlayLift'],
      fit: data.fit === 'cover' || data.fit === 'fill' ? data.fit : 'contain',
      relay: data.relay === true,
      bitrateKbps: within(data.bitrateKbps, 0, 50000, defaults.bitrateKbps),
      deadzone: within(data.deadzone, 0, 0.4, defaults.deadzone),
      swapAB: data.swapAB === true,
      autoReconnect: data.autoReconnect !== false,
    }
  } catch {
    return defaults
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState(read)
  const [storageError, setStorageError] = useState(false)
  function update(changes: Partial<Preferences>) {
    const next = { ...preferences, ...changes }
    setPreferences(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }
  return { preferences, update, storageError }
}
