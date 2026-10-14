// Camera focal length (from calibration, else a default field of view) and the per-anchor
// print-scale correction, kept per browser in localStorage. Storage can be unavailable
// (private mode, blocked site data): every access is wrapped and falls back to defaults.
import { centredIntrinsics, focalFromHfov, type Intrinsics } from '../pose'

export type StoredIntrinsics = { f: number; videoW: number; videoH: number; source: 'calibrated' | 'default'; at: string }

export const DEFAULT_HFOV_DEG = 63
/** A printer that shrinks or enlarges more than this is a mistake, not a correction. */
export const QR_SCALE_LIMITS = [0.8, 1.2] as const

const PREFIX = 'truesite.'

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value)
  } catch {
    /* storage unavailable: keep defaults */
  }
}

/** Width x height of the delivered video frame; portrait and landscape get separate entries. */
export function intrinsicsKey(videoW: number, videoH: number): string {
  return `intrinsics.${videoW}x${videoH}`
}

function stored(videoW: number, videoH: number): StoredIntrinsics | null {
  const raw = read(intrinsicsKey(videoW, videoH))
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as StoredIntrinsics
    return Number.isFinite(s.f) && s.f > 0 && s.videoW === videoW && s.videoH === videoH ? s : null
  } catch {
    return null
  }
}

export function isCalibrated(videoW: number, videoH: number): boolean {
  return stored(videoW, videoH)?.source === 'calibrated'
}

export function loadIntrinsics(videoW: number, videoH: number): Intrinsics {
  const f = stored(videoW, videoH)?.f ?? focalFromHfov(DEFAULT_HFOV_DEG, videoW)
  return centredIntrinsics(f, videoW, videoH)
}

export function saveIntrinsics(videoW: number, videoH: number, f: number): void {
  if (!Number.isFinite(f) || f <= 0) throw new Error(`invalid focal length ${f}`)
  const s: StoredIntrinsics = { f, videoW, videoH, source: 'calibrated', at: new Date().toISOString() }
  write(intrinsicsKey(videoW, videoH), JSON.stringify(s))
}

/** Multiplier for the anchor's printed QR size (measured check bar / 100 mm); 1 when unknown. */
export function loadQrSizeCorrection(anchorId: string): number {
  const v = Number(read(`qrscale.${anchorId}`))
  return Number.isFinite(v) && v >= QR_SCALE_LIMITS[0] && v <= QR_SCALE_LIMITS[1] ? v : 1
}

export function saveQrSizeCorrection(anchorId: string, factor: number): void {
  if (!(factor >= QR_SCALE_LIMITS[0] && factor <= QR_SCALE_LIMITS[1])) {
    throw new Error(`print scale ${factor} is outside ${QR_SCALE_LIMITS.join('–')}: reprint at 100%`)
  }
  write(`qrscale.${anchorId}`, String(factor))
}
