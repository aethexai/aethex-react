import { useEffect, useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"
import {
  AlphaType,
  Canvas,
  ColorType,
  FilterMode,
  Group,
  Image,
  MipmapMode,
  Rect,
  rect,
  rrect,
  Skia,
  type SkImage,
} from "@shopify/react-native-skia"

import { nativePlatform } from "../native/platform.js"
import { useAethexCall, type UseAethexCallOptions } from "../react/useAethexCall.js"
import { makeCfg, makeFingerprint, type OrbType } from "./voiceVisual/fingerprint.js"
import type { AethexVoiceOrbLabels } from "./AethexVoiceOrb.js"

export type { OrbType } from "./voiceVisual/fingerprint.js"
export type { AethexVoiceOrbLabels } from "./AethexVoiceOrb.js"

const SIZE = { sm: 120, md: 160, lg: 200 } as const

export interface AethexVoiceOrbProps extends UseAethexCallOptions {
  /** Texture variant. Colour is always seeded from the agent. */
  orbType?: OrbType
  /** Seed for the orb's colour + pattern. Defaults to `agentId`. */
  agentName?: string
  /** Orb diameter in px, or a size preset. */
  size?: number | "sm" | "md" | "lg"
  theme?: "dark" | "light"
  /** Label under the orb at rest; call status replaces it during a call. */
  title?: string
  labels?: AethexVoiceOrbLabels
  /** Show in-call controls under the orb — a mute toggle and a red hang-up button. */
  controls?: boolean
  /** After a call ends, show a 👍 / 👎 prompt that submits a rating (5 / 1). */
  feedback?: boolean
  style?: StyleProp<ViewStyle>
}

/**
 * React Native voice orb — the native twin of the web `<AethexVoiceOrb>`. Same
 * seeded fingerprint (rendered with Skia instead of a DOM canvas), same call
 * API. The orb IS the button: tap to start, tap to hang up. WebRTC + loudspeaker
 * routing come from the native platform adapter, so there's nothing else to wire.
 */
export function AethexVoiceOrb(props: AethexVoiceOrbProps) {
  const {
    orbType = "aurora",
    agentName,
    size = "md",
    theme = "dark",
    title,
    labels = {},
    controls = false,
    feedback = false,
    style,
    ...callOptions
  } = props

  const {
    status,
    isConnected,
    isConnecting,
    isSpeaking,
    isMuted,
    start,
    stop,
    error,
    toggleMute,
    submitFeedback,
  } = useAethexCall({
    ...callOptions,
    platform: callOptions.platform ?? nativePlatform,
  })
  const active = isConnecting || isConnected
  const px = typeof size === "number" ? Math.round(size) : SIZE[size]
  const seed = agentName ?? props.agentId ?? "aethex"

  const [feedbackSent, setFeedbackSent] = useState(false)
  useEffect(() => {
    if (status === "connecting") setFeedbackSent(false)
  }, [status])

  const light = theme === "light"
  const ink = light ? "#1A1D27" : "#E7EAF3"
  const surface = light ? "#eef0f5" : "#12141d"
  const line = light ? "#E4E7F0" : "#2A2E3A"

  const fp = useMemo(() => makeFingerprint(makeCfg(seed, orbType, theme), px * 2), [seed, orbType, theme, px])
  const toImage = (t: number): SkImage | null =>
    Skia.Image.MakeImage(
      { width: fp.G, height: fp.G, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque },
      Skia.Data.fromBytes(fp.render(t)),
      fp.G * 4,
    )

  const [image, setImage] = useState<SkImage | null>(() => toImage(0))
  useEffect(() => {
    setImage(toImage(0.42))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp])
  useEffect(() => {
    if (!active) return
    let raf = 0
    const t0 = Date.now()
    const tick = () => {
      setImage(toImage(((Date.now() - t0) % 8000) / 8000))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, fp])

  const clip = useMemo(() => rrect(rect(0, 0, px, px), px / 2, px / 2), [px])
  const bg = theme === "light" ? "#eef0f5" : "#000000"
  const scanColor = theme === "light" ? `rgba(255,255,255,${fp.scan.alpha})` : `rgba(0,0,0,${fp.scan.alpha})`
  const scanStep = Math.max(2, Math.round(fp.scan.period / 2))
  const scanX: number[] = []
  if (fp.scan.show) for (let x = 0; x < px; x += scanStep) scanX.push(x)

  const statusText = isConnecting
    ? (labels.connecting ?? "Connecting…")
    : isConnected
      ? (labels.connected ?? "In call")
      : status === "error"
        ? (labels.failed ?? "Couldn’t connect")
        : (labels.idle ?? title)

  return (
    <View style={[styles.wrap, style]}>
      {/* The orb IS the primary button; controls sit outside it so their taps
          don't fight the orb's press responder. */}
      <Pressable
        onPress={isConnected ? stop : start}
        style={({ pressed }: { pressed: boolean }) => [
          { opacity: pressed ? 0.86 : 1, transform: [{ scale: isSpeaking ? 1.03 : 1 }] },
        ]}
        accessibilityRole="button"
        accessibilityLabel={statusText ?? "Voice call"}
      >
        <Canvas style={{ width: px, height: px }}>
          <Group clip={clip}>
            <Rect x={0} y={0} width={px} height={px} color={bg} />
            {image ? (
              <Image
                image={image}
                x={0}
                y={0}
                width={px}
                height={px}
                fit="fill"
                sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
              />
            ) : null}
            {scanX.map((x) => (
              <Rect key={x} x={x} y={0} width={1} height={px} color={scanColor} />
            ))}
          </Group>
        </Canvas>
      </Pressable>

      {statusText ? <Text style={[styles.label, { color: ink }]}>{statusText}</Text> : null}
      {error ? <Text style={styles.error}>{error.code}</Text> : null}

      {controls && active ? (
        <View style={styles.row}>
          <Pressable
            onPress={() => toggleMute()}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? "Unmute microphone" : "Mute microphone"}
            style={[
              styles.ctrl,
              { backgroundColor: isMuted ? "#7C6CFF" : surface, borderColor: isMuted ? "#7C6CFF" : line },
            ]}
          >
            <Text style={styles.glyph}>{isMuted ? "🔇" : "🎤"}</Text>
          </Pressable>
          <Pressable
            onPress={stop}
            accessibilityRole="button"
            accessibilityLabel="Hang up"
            style={[styles.ctrl, styles.ctrlDanger]}
          >
            <Text style={[styles.glyph, styles.dangerGlyph]}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {feedback && status === "ended" ? (
        <View style={styles.row}>
          {feedbackSent ? (
            <Text style={[styles.thanks, { color: light ? "#697086" : "#9097AC" }]}>
              Thanks for the feedback
            </Text>
          ) : (
            <>
              <Pressable
                onPress={() => void submitFeedback(5).finally(() => setFeedbackSent(true))}
                accessibilityRole="button"
                accessibilityLabel="Good call"
                style={[styles.ctrl, { backgroundColor: surface, borderColor: line }]}
              >
                <Text style={styles.glyph}>👍</Text>
              </Pressable>
              <Pressable
                onPress={() => void submitFeedback(1).finally(() => setFeedbackSent(true))}
                accessibilityRole="button"
                accessibilityLabel="Bad call"
                style={[styles.ctrl, { backgroundColor: surface, borderColor: line }]}
              >
                <Text style={styles.glyph}>👎</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 10 },
  label: { fontSize: 15, fontWeight: "600" },
  error: { color: "#F0566B", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
  ctrl: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlDanger: { backgroundColor: "#F0566B", borderColor: "#F0566B" },
  glyph: { fontSize: 22 },
  dangerGlyph: { color: "#ffffff", fontWeight: "800" },
  thanks: { fontSize: 14 },
})
