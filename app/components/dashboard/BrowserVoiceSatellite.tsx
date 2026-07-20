"use client";

import { useEffect, useRef } from "react";
import { effectiveAlwaysOn, useVoiceAgentSetting } from "./voiceAgentSetting";
import {
  ensureAlwaysOn,
  isSecureVoiceContext,
  markInput,
  useVoiceMode,
} from "./voiceMode";
import { BrowserSatellite } from "./browserSatellite";
import { useVoiceSpeechPhase } from "./voiceSpeech";

// Headless controller that runs the browser voice satellite when this device is
// a native-input voice satellite. It bridges the voice-mode store (which the
// orb reads) to the transport runtime: starts/stops capture with voice mode,
// fires the push-to-talk begin_turn on a tapped turn, and reflects agent speech
// as conversation activity for always-on devices.
//
// Voice-disabled devices never mount a real satellite here — the browser mic is
// never opened. A separate native satellite process on the same machine is
// unaffected and keeps capturing on its own.

const SAT_ID_KEY = "nova.dashboard.voiceSatelliteId.v1";
const DEFAULT_ROOM =
  process.env.NEXT_PUBLIC_NOVA_BROWSER_SAT_ROOM?.trim() || "lounge";

function deviceSatelliteId(): string {
  try {
    const existing = window.localStorage.getItem(SAT_ID_KEY);
    if (existing) return existing;
    const generated = `web-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SAT_ID_KEY, generated);
    return generated;
  } catch {
    return `web-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function bridgeUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_NOVA_VOICE_BRIDGE_URL?.trim();
  if (explicit) return explicit;

  // Production routes the bridge through Caddy on the dashboard's own HTTPS
  // origin. Keeping this same-origin avoids a second browser-visible TLS
  // endpoint/certificate and gives every Tailscale-enrolled device one URL.
  // NEXT_PUBLIC_NOVA_VOICE_BRIDGE_PORT remains as a legacy/development escape
  // hatch for a directly exposed bridge.
  const url = new URL("/voice-satellite", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const explicitPort = process.env.NEXT_PUBLIC_NOVA_VOICE_BRIDGE_PORT?.trim();
  if (explicitPort) url.port = explicitPort;
  return url.toString();
}

export default function BrowserVoiceSatellite() {
  const [setting] = useVoiceAgentSetting();
  const voice = useVoiceMode();
  const speechPhase = useVoiceSpeechPhase();

  const satelliteRef = useRef<BrowserSatellite | null>(null);
  const prevConversationRef = useRef(false);
  const prevSpeechRef = useRef(speechPhase);

  const alwaysOn = effectiveAlwaysOn(setting);

  // Always-on devices load with voice mode on.
  useEffect(() => {
    if (alwaysOn && voice.eligible) {
      ensureAlwaysOn(true);
    }
  }, [alwaysOn, voice.eligible]);

  // Start/stop the transport with voice mode. Only voice-enabled, secure-context
  // devices open the mic.
  useEffect(() => {
    const shouldRun = voice.eligible && voice.active && isSecureVoiceContext();

    if (shouldRun && !satelliteRef.current) {
      const satellite = new BrowserSatellite(
        bridgeUrl(),
        {
          satelliteId: deviceSatelliteId(),
          displayName: "Web Dashboard",
          roomId: DEFAULT_ROOM,
          capturePolicy: alwaysOn ? "always" : "push-to-talk",
        },
        {
          onClose: () => {
            satelliteRef.current = null;
          },
          onError: (error) => console.error("[browser-satellite]", error),
        },
      );
      satelliteRef.current = satellite;
      satellite.start().catch((error) => {
        console.error("[browser-satellite] failed to start", error);
        satelliteRef.current = null;
      });
    } else if (!shouldRun && satelliteRef.current) {
      satelliteRef.current.stop();
      satelliteRef.current = null;
    }
  }, [voice.eligible, voice.active, alwaysOn]);

  // Fire the push-to-talk begin_turn when a tapped turn opens.
  useEffect(() => {
    const opened = voice.conversationActive && !prevConversationRef.current;
    prevConversationRef.current = voice.conversationActive;
    if (opened && voice.tappable) {
      satelliteRef.current?.beginTurn();
    }
  }, [voice.conversationActive, voice.tappable]);

  // Always-on devices: treat the start of agent speech as conversation activity
  // (the wake-word turn is server-side; this is the client's visible signal).
  useEffect(() => {
    const prev = prevSpeechRef.current;
    prevSpeechRef.current = speechPhase;
    if (alwaysOn && voice.active && prev === "idle" && speechPhase !== "idle") {
      markInput();
    }
  }, [speechPhase, alwaysOn, voice.active]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      satelliteRef.current?.stop();
      satelliteRef.current = null;
    };
  }, []);

  return null;
}
