import { act, fireEvent, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"
import { AethexCallButton } from "../../src/widgets/AethexCallButton.js"
import { AethexVoiceWidget } from "../../src/widgets/AethexVoiceWidget.js"
import { AethexVoiceOrb } from "../../src/widgets/AethexVoiceOrb.js"
import { installWebRTCMocks } from "../mocks/webrtc.js"

const BASE = "https://proxy.example.com"
const AGENT = "11111111-1111-1111-1111-111111111111"

async function expectNoA11yViolations(container: HTMLElement) {
  // color-contrast can't be computed in jsdom; disable that rule only.
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } })
  expect(results.violations.map((v) => v.id)).toEqual([])
}

/** Install a matchMedia mock for prefers-reduced-motion. */
function mockReducedMotion(matches: boolean) {
  ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (q: string) =>
    ({
      matches,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia
})

describe("AethexCallButton", () => {
  it("toggles between start and hang-up across the lifecycle (state via label)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    render(<AethexCallButton agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} />)

    const btn = screen.getByRole("button")
    expect(btn).toHaveTextContent("Start call")
    expect(btn).toHaveAttribute("data-status", "idle")

    await act(async () => {
      fireEvent.click(btn)
    })
    expect(btn).toHaveAttribute("aria-busy", "true")

    act(() => {
      recorder.lastPc?.setState("connected")
    })
    expect(btn).toHaveTextContent("End call")
    expect(btn).toHaveAttribute("data-status", "connected")

    act(() => {
      fireEvent.click(btn)
    })
    expect(recorder.ops.filter((o) => o === "close")).toHaveLength(1)
  })

  it("stays enabled while connecting and can cancel (keyboard focus preserved)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    render(<AethexCallButton agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} />)
    const btn = screen.getByRole("button")

    await act(async () => {
      fireEvent.click(btn)
    })
    // connecting: NOT disabled (focusable / in tab order), marked busy
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAttribute("aria-busy", "true")

    act(() => {
      fireEvent.click(btn) // cancel during connecting
    })
    expect(recorder.ops.filter((o) => o === "close")).toHaveLength(1)
  })

  it("announces status via an aria-live region and passes axe", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { container } = render(<AethexCallButton agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} />)
    expect(screen.getByRole("status")).toHaveTextContent("Idle")
    await expectNoA11yViolations(container)
  })

  it("shows a retry label and stays accessible on error", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "denied" })
    const { container } = render(<AethexCallButton agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} />)
    fireEvent.click(screen.getByRole("button"))
    expect(await screen.findByText("Call failed — retry")).toBeInTheDocument()
    await expectNoA11yViolations(container)
  })
})

describe("AethexVoiceWidget", () => {
  it("renders an accessible region and an animated visualizer with `bins` bars when connected", async () => {
    mockReducedMotion(false)
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { container } = render(
      <AethexVoiceWidget
        agentId={AGENT}
        apiBaseUrl={BASE}
        fetchImpl={fetchImpl}
        title="Talk to Kora"
        bins={5}
      />,
    )

    expect(screen.getByRole("region", { name: "Talk to Kora" })).toBeInTheDocument()
    await expectNoA11yViolations(container)

    await act(async () => {
      fireEvent.click(screen.getByRole("button"))
    })
    act(() => {
      recorder.lastPc?.setState("connected")
      recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    })
    expect(screen.getByText("In call")).toBeInTheDocument()
    const viz = container.querySelector('[data-aethex="visualizer"]')
    expect(viz).not.toBeNull()
    expect(viz?.querySelectorAll("span")).toHaveLength(5) // one bar per bin
    expect(viz).toHaveAttribute("aria-hidden", "true")
    await expectNoA11yViolations(container)
  })

  it("renders a static indicator (no animated bars) under prefers-reduced-motion", async () => {
    mockReducedMotion(true)
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { container } = render(
      <AethexVoiceWidget agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button"))
    })
    act(() => {
      recorder.lastPc?.setState("connected")
      recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    })
    expect(screen.getByText("● Live")).toBeInTheDocument()
    expect(container.querySelector('[data-aethex="visualizer"]')).toBeNull()
  })

  it("surfaces the error once on failure (single live region)", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted", offer: { ok: false, status: 503 } })
    const { container } = render(
      <AethexVoiceWidget agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} />,
    )
    fireEvent.click(screen.getByRole("button"))
    expect(await screen.findByText(/Call failed:/)).toBeInTheDocument()
    // exactly one live region (the role="status"), so no double announcement
    expect(container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1)
  })
})

describe("AethexVoiceOrb", () => {
  it("starts the call when the capsule is tapped — the whole thing is one button", async () => {
    mockReducedMotion(false)
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    render(<AethexVoiceOrb agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} title="Talk to Kora" />)

    // exactly one control: the whole capsule (no separate action button)
    const btn = screen.getByRole("button")
    expect(btn).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("Talk to Kora", { selector: ".aethex-orb__txt" })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(btn)
    })
    expect(btn).toHaveAttribute("aria-busy", "true") // connecting

    act(() => {
      recorder.lastPc?.setState("connected")
      recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    })
    expect(btn).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("In call", { selector: ".aethex-orb__txt" })).toBeInTheDocument()

    // tapping again hangs up
    act(() => {
      fireEvent.click(btn)
    })
    expect(recorder.ops.filter((o) => o === "close")).toHaveLength(1)
  })

  it("renders just the orb (named, accessible) when no title is given", async () => {
    mockReducedMotion(false)
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { container } = render(<AethexVoiceOrb agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} />)
    const btn = screen.getByRole("button", { name: "Start voice call" })
    expect(btn).toHaveAttribute("data-orb-only", "true")
    expect(container.querySelector(".aethex-orb__body")).toBeNull()
    await expectNoA11yViolations(container)
  })

  it("applies size / labels / colors / theme via props and stays accessible", async () => {
    mockReducedMotion(false)
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { container } = render(
      <AethexVoiceOrb
        agentId={AGENT}
        apiBaseUrl={BASE}
        fetchImpl={fetchImpl}
        title="Voice"
        description="Ask anything"
        orbType="pulse"
        accent="#1FBF75"
        textColor="#101010"
        theme="dark"
        size="lg"
      />,
    )
    const btn = screen.getByRole("button")
    expect(btn).toHaveAttribute("data-theme", "dark")
    expect(btn).toHaveAttribute("data-size", "lg")
    expect((btn as HTMLElement).style.getPropertyValue("--aethex-accent")).toBe("#1FBF75")
    expect((btn as HTMLElement).style.getPropertyValue("--aethex-ink")).toBe("#101010")
    expect(screen.getByText("Ask anything")).toBeInTheDocument() // description sub-line at rest
    await expectNoA11yViolations(container)
  })

  it("renders a circle-masked <video> (no canvas) when videoSrc is a string", async () => {
    mockReducedMotion(false)
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { container } = render(
      <AethexVoiceOrb agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} videoSrc="/orb.mp4" />,
    )
    const video = container.querySelector(".aethex-orb__orb video") as HTMLVideoElement | null
    expect(video).not.toBeNull()
    expect(video?.getAttribute("src")).toBe("/orb.mp4")
    expect(video).toHaveAttribute("aria-hidden", "true") // decorative — the button carries the label
    expect(container.querySelector(".aethex-orb__orb canvas")).toBeNull() // canvas path skipped
  })

  it("swaps the clip by phase when videoSrc is a per-phase map", async () => {
    mockReducedMotion(false)
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { container } = render(
      <AethexVoiceOrb
        agentId={AGENT}
        apiBaseUrl={BASE}
        fetchImpl={fetchImpl}
        videoSrc={{ idle: "/idle.mp4", incall: "/incall.mp4" }}
      />,
    )
    const src = () => container.querySelector(".aethex-orb__orb video")?.getAttribute("src")
    expect(src()).toBe("/idle.mp4")

    await act(async () => {
      fireEvent.click(screen.getByRole("button"))
    })
    act(() => {
      recorder.lastPc?.setState("connected")
      recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    })
    expect(src()).toBe("/incall.mp4") // in-call clip
  })

  it("floats bottom-right by default (fixed, high z-index) and can opt out", async () => {
    mockReducedMotion(false)
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })

    const { rerender } = render(<AethexVoiceOrb agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} />)
    const btn = () => screen.getByRole("button")
    expect(btn()).toHaveAttribute("data-float", "bottom-right")
    expect((btn() as HTMLElement).style.position).toBe("fixed")
    expect((btn() as HTMLElement).style.bottom).toBe("24px")
    expect((btn() as HTMLElement).style.right).toBe("24px")
    expect((btn() as HTMLElement).style.zIndex).toBe("9999")

    // float={false} → inline, no fixed positioning
    rerender(<AethexVoiceOrb agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} float={false} />)
    expect(btn()).not.toHaveAttribute("data-float")
    expect((btn() as HTMLElement).style.position).toBe("")
  })

  it("honors a specific corner, custom offset and z-index", async () => {
    mockReducedMotion(false)
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    render(
      <AethexVoiceOrb
        agentId={AGENT}
        apiBaseUrl={BASE}
        fetchImpl={fetchImpl}
        float="top-left"
        floatOffset={40}
        zIndex={1200}
      />,
    )
    const btn = screen.getByRole("button") as HTMLElement
    expect(btn).toHaveAttribute("data-float", "top-left")
    expect(btn.style.top).toBe("40px")
    expect(btn.style.left).toBe("40px")
    expect(btn.style.zIndex).toBe("1200")
  })

  it("controls: mute toggles the mic, hang-up ends the call, and the cluster is accessible", async () => {
    mockReducedMotion(false)
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { container } = render(
      <AethexVoiceOrb
        agentId={AGENT}
        apiBaseUrl={BASE}
        fetchImpl={fetchImpl}
        title="Kora"
        controls
        float={false}
      />,
    )
    // idle: only the orb button (no control row yet)
    expect(screen.getAllByRole("button")).toHaveLength(1)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start voice call/ }))
    })
    act(() => {
      recorder.lastPc?.setState("connected")
      recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    })
    await expectNoA11yViolations(container)

    const track = (recorder.lastPc?.tracks as Array<{ enabled?: boolean }>)[0]!
    act(() => fireEvent.click(screen.getByRole("button", { name: "Mute microphone" })))
    expect(track.enabled).toBe(false)
    expect(screen.getByRole("button", { name: "Unmute microphone" })).toHaveAttribute("aria-pressed", "true")

    act(() => fireEvent.click(screen.getByRole("button", { name: "Hang up" })))
    expect(recorder.ops.filter((o) => o === "close")).toHaveLength(1)
  })

  it("showVolume: renders a volume slider that drives the agent output volume", async () => {
    mockReducedMotion(false)
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    render(
      <AethexVoiceOrb agentId={AGENT} apiBaseUrl={BASE} fetchImpl={fetchImpl} showVolume float={false} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start voice call/ }))
    })
    act(() => {
      recorder.lastPc?.setState("connected")
      recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    })
    const slider = screen.getByRole("slider", { name: "Output volume" }) as HTMLInputElement
    act(() => fireEvent.change(slider, { target: { value: "0.3" } }))
    const audio = document.querySelector("audio") as HTMLAudioElement
    expect(audio.volume).toBeCloseTo(0.3)
  })

  it("feedback: shows a post-call rating prompt that submits via the call token", async () => {
    mockReducedMotion(false)
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    render(
      <AethexVoiceOrb
        agentId={AGENT}
        apiBaseUrl={BASE}
        fetchImpl={fetchImpl}
        title="Kora"
        feedback
        float={false}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start voice call/ }))
    })
    act(() => {
      recorder.lastPc?.setState("connected")
      recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    })
    // hang up (tap the orb) → status ended → the thumbs prompt appears
    act(() => fireEvent.click(screen.getByRole("button", { name: /End voice call/ })))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Good call" }))
    })
    expect(recorder.feedback).toEqual({ rating: 5 })
    expect(screen.getByText("Thanks for the feedback")).toBeInTheDocument()
  })
})
