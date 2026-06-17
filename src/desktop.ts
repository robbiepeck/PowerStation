import type { PowerStationBridge } from './types'

declare global {
  interface Window {
    powerStation?: PowerStationBridge
  }
}

let bridge: PowerStationBridge | null = null

export function getDesktop(): PowerStationBridge {
  if (bridge) return bridge
  if (!window.powerStation) {
    throw new Error('PowerStation must run inside the desktop app. Browser mode is not supported.')
  }
  bridge = window.powerStation
  return bridge
}
