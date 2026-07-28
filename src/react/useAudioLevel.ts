// "use client" is injected into the published bundle by the tsup banner.
import { useEffect, useRef, useState, type MutableRefObject } from "react"

export interface AudioLevel {
  /** Smoothed overall RMS level, 0..1. */
  level: number
  /** Per-bin levels (0..1) for a bar visualizer. */
  bars: number[]
}

/** Default number of visualizer bins, shared by the hook and the widgets. */
export const DEFAULT_BINS = 7

/**
 * Shared Web Audio plumbing for the level hooks. Builds an AnalyserNode over the
 * stream, runs a `requestAnimationFrame` loop that computes a smoothed 0..1 RMS
 * level, and invokes `onFrame(level, freq)` each frame with the raw frequency
 * bins so callers can derive their own per-bin values. Returns a teardown, or
 * `null` when Web Audio is unavailable (SSR / unsupported host). Also resumes a
 * suspended context on the first user gesture (autoplay policy).
 */
function meterStream(
  stream: MediaStream,
  onFrame: (level: number, freq: Uint8Array) => void,
): (() => void) | null {
  const Ctor: typeof AudioContext | undefined =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined
  if (!Ctor) return null

  const ctx = new Ctor()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.72
  src.connect(analyser)
  const freq = new Uint8Array(analyser.frequencyBinCount)

  let raf = 0
  let alive = true
  let last = 0
  const tick = () => {
    if (!alive) return
    analyser.getByteFrequencyData(freq)
    let sum = 0
    for (let i = 0; i < freq.length; i++) sum += (freq[i] ?? 0) * (freq[i] ?? 0)
    last = last * 0.6 + (Math.sqrt(sum / freq.length) / 255) * 0.4
    onFrame(last, freq)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  // Autoplay policy: the context may start suspended until a user gesture.
  const resume = () => void ctx.resume().catch(() => {})
  document.addEventListener("click", resume, { once: true })

  return () => {
    alive = false
    cancelAnimationFrame(raf)
    try {
      src.disconnect()
    } catch {
      /* ignore */
    }
    try {
      analyser.disconnect()
    } catch {
      /* ignore */
    }
    void ctx.close().catch(() => {})
    document.removeEventListener("click", resume)
  }
}

/**
 * Taps a remote MediaStream and exposes a smoothed overall level plus per-bin
 * levels for a visualizer. SSR-safe (no AudioContext access until the effect
 * runs) and degrades to zeros when Web Audio is unavailable.
 *
 * Pass a **stable** `bins` value: changing it tears down and recreates the
 * AudioContext (browsers cap concurrent contexts at ~6).
 */
export function useAudioLevel(stream: MediaStream | null, bins = DEFAULT_BINS): AudioLevel {
  const [level, setLevel] = useState(0)
  const [bars, setBars] = useState<number[]>(() => new Array<number>(bins).fill(0))

  useEffect(() => {
    if (!stream) {
      setLevel(0)
      setBars(new Array<number>(bins).fill(0))
      return
    }
    const next = new Array<number>(bins).fill(0)
    const stop = meterStream(stream, (lvl, freq) => {
      setLevel(lvl)
      const usable = Math.floor(freq.length * 0.55)
      const bucket = Math.max(1, Math.floor(usable / bins))
      for (let b = 0; b < bins; b++) {
        let acc = 0
        for (let j = 0; j < bucket; j++) acc += freq[b * bucket + j] ?? 0
        next[b] = acc / bucket / 255
      }
      setBars([...next])
    })
    return stop ?? undefined
  }, [stream, bins])

  return { level, bars }
}

/**
 * Like {@link useAudioLevel} but writes the smoothed level into a ref instead of
 * React state — so a high-frequency (per-frame) consumer such as a canvas
 * `requestAnimationFrame` loop can read it WITHOUT re-rendering the component on
 * every audio frame. Returns a stable ref holding the latest level (0..1).
 * SSR-safe; degrades to a ref that stays 0 when Web Audio is unavailable.
 */
export function useAudioLevelRef(stream: MediaStream | null): MutableRefObject<number> {
  const ref = useRef(0)
  useEffect(() => {
    ref.current = 0
    if (!stream) return
    const stop = meterStream(stream, (lvl) => {
      ref.current = lvl
    })
    return () => {
      stop?.()
      ref.current = 0
    }
  }, [stream])

  return ref
}
