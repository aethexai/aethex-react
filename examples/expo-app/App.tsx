import { SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native"

import { AethexVoiceOrb } from "@aethexai/react/widgets"

// The phone mints a short-lived token from your server route (which holds the
// key), then connects to the Aethex API directly. EXPO_PUBLIC_* is readable in
// the app; the API key never is. The SDK orb handles the call, the loudspeaker
// routing, mute, hang-up and the post-call feedback prompt on its own.
const TOKEN_URL = process.env.EXPO_PUBLIC_AETHEX_TOKEN_URL ?? "https://your-worker.example.workers.dev/token"
const AGENT_ID = process.env.EXPO_PUBLIC_AETHEX_AGENT_ID ?? "11111111-1111-1111-1111-111111111111"
const AGENT_NAME = process.env.EXPO_PUBLIC_AETHEX_AGENT_NAME ?? "Kora" // seeds the orb's colour

export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <View style={styles.center}>
        <Text style={styles.title}>Aethex voice</Text>

        <AethexVoiceOrb
          agentId={AGENT_ID}
          agentName={AGENT_NAME}
          getToken={async () => {
            const res = await fetch(TOKEN_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agent_id: AGENT_ID }),
            })
            if (!res.ok) throw new Error(`token mint failed: ${res.status}`)
            return (await res.json()).token as string
          }}
          orbType="aurora"
          size={200}
          theme="dark"
          title="Tap to talk"
          controls
          feedback
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B0E14" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 18 },
  title: { color: "#E7EAF3", fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
})
