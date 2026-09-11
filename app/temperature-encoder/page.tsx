"use client";

/**
 * Demo of TemperatureEncoder (specs/temperature-encoder.md).
 *
 * Every knob is live on local state: no Home Assistant, no commands. This is
 * what the e2e specs drive and what the visual review is taken from.
 */
import type { CSSProperties, ReactNode } from "react";
import { DemoTemperatureDial } from "../components/TemperatureEncoderDemo";

function Section({ children, light, title }: { children: ReactNode; light?: boolean; title: string }) {
  return (
    <section
      style={{
        ...styles.section,
        // The dial paints itself in --background, so a pale one here puts the
        // knobs inside this section into their light treatment.
        ...(light ? ({ "--background": "#eceef1", background: "#dfe2e6", color: "#1b1e23" } as CSSProperties) : null),
      }}
    >
      <h2 style={styles.heading}>{title}</h2>
      <div style={styles.row}>{children}</div>
    </section>
  );
}

export default function TemperatureEncoderDemo() {
  return (
    <main style={styles.page}>
      <h1 style={styles.title}>TemperatureEncoder</h1>

      <Section title="Air conditioner, four rings">
        <DemoTemperatureDial id="aircon-200" size={200} timerMinutes={38} />
        <DemoTemperatureDial id="aircon-150" size={150} />
        <DemoTemperatureDial id="aircon-100" size={100} />
      </Section>

      <Section title="Heater, one ring">
        <DemoTemperatureDial id="heater-200" kind="heater" size={200} startMode="auto" target={19} />
        <DemoTemperatureDial id="heater-100" kind="heater" size={100} startMode="off" target={19} />
      </Section>

      <Section title="Temperatures across the scale">
        <DemoTemperatureDial id="cold" room={16} target={18} />
        <DemoTemperatureDial id="mid" room={22} target={22} />
        <DemoTemperatureDial id="hot" room={28} target={26} />
        <DemoTemperatureDial id="no-room" room={null} target={23} />
      </Section>

      <Section light title="Light theme">
        <DemoTemperatureDial id="light-aircon" size={200} timerMinutes={12} />
        <DemoTemperatureDial id="light-heater" kind="heater" size={100} />
      </Section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    boxSizing: "border-box",
    paddingBlock: 24,
    paddingInline: 16,
    background: "var(--background, #050608)",
    color: "var(--cyber-text, #e5e7eb)",
    overflowY: "auto",
    height: "100vh",
  },
  title: {
    margin: "0 0 16px",
    fontSize: 18,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  section: {
    marginBottom: 24,
    padding: 16,
    borderRadius: 12,
  },
  heading: {
    margin: "0 0 12px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    opacity: 0.7,
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    // Room for the rings, which float outside the knob's own box.
    gap: 96,
  },
};
