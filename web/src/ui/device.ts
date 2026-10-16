/** Is this a tablet or a phone? Live AR is made for them; on a laptop or PC we recommend switching (DeviceTip). */
export type DeviceInfo = { ua: string; platform: string; maxTouchPoints: number; coarsePointer: boolean }

export function readDevice(): DeviceInfo {
  return {
    ua: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    coarsePointer: typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
  }
}

/** Touch-first devices. iPadOS Safari reports a Mac, so it is caught by its touch points; width is not used at all. */
export function isHandheld(d: DeviceInfo = readDevice()): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(d.ua)) return true
  if (d.platform === 'MacIntel' && d.maxTouchPoints > 1) return true
  return d.coarsePointer && d.maxTouchPoints > 0
}
