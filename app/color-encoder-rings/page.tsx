"use client";

/**
 * Demo of RingedColorEncoder (specs/color-encoder-rings.md, "Demo page").
 * Every dial is live with local state only; nothing leaves the page.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  RingedColorEncoder,
  RINGED_ENCODER_CHANNELS,
  RINGED_ENCODER_CHANNELS_WITH_ALPHA,
  type RingedColorEncoderChannel,
} from "../components/RingedColorEncoder";
import type { Hsva } from "../components/colorEncoderModel";

const RING_NAMES = ["Opacity", "Size", "Glow", "Speed", "Softness"];

type DemoDialProps = {
  channels?: RingedColorEncoderChannel[];
  disabled?: boolean;
  id: string;
  label: string;
  rings: number;
  size: number;
};

function DemoDial({ channels = RINGED_ENCODER_CHANNELS, disabled, id, label, rings, size }: DemoDialProps) {
  const [colour, setColour] = useState<Hsva>({ h: 200, s: 70, v: 85, a: 80 });
  const [values, setValues] = useState<number[]>(() => RING_NAMES.map((_, index) => 20 + index * 15));

  return (
    <figure style={styles.figure} data-demo-dial={id}>
      <RingedColorEncoder
        channels={channels}
        disabled={disabled}
        label={label}
        size={size}
        value={colour}
        onChange={setColour}
        rings={RING_NAMES.slice(0, rings).map((name, index) => ({
          id: name.toLowerCase(),
          label: name,
          value: values[index],
          onChange: (next: number) => setValues((current) => current.map((item, at) => (at === index ? next : item))),
        }))}
      />
      <figcaption style={styles.caption} data-demo-readout>
        {size}px · {rings} ring{rings === 1 ? "" : "s"}
        {rings > 0 ? ` · ${values.slice(0, rings).map((item) => Math.round(item)).join(" / ")}` : ""}
      </figcaption>
    </figure>
  );
}

function Section({ children, light, title }: { children: ReactNode; light?: boolean; title: string }) {
  return (
    <section
      style={{
        ...styles.section,
        // The dial paints itself in --background, so a pale one here puts the
        // dials inside this section into their light treatment.
        ...(light ? ({ "--background": "#eceef1", background: "#dfe2e6", color: "#1b1e23" } as CSSProperties) : null),
      }}
    >
      <h2 style={styles.heading}>{title}</h2>
      <div style={styles.row}>{children}</div>
    </section>
  );
}

export default function ColorEncoderRingsDemo() {
  return (
    <main style={styles.page}>
      <h1 style={styles.title}>RingedColorEncoder</h1>

      <Section title="Ring count, 200px">
        {[0, 1, 2, 3, 4, 5].map((rings) => (
          <DemoDial key={rings} id={`count-${rings}`} label="Lights" rings={rings} size={200} />
        ))}
      </Section>

      <Section title="Size sweep, 5 rings">
        {[200, 100, 56].map((size) => (
          <DemoDial key={size} id={`size-${size}`} label="Lights" rings={5} size={size} />
        ))}
      </Section>

      <Section light title="Light theme">
        <DemoDial id="light-5" label="Lights" rings={5} size={200} />
        <DemoDial id="light-100" label="Lights" rings={3} size={100} />
      </Section>

      <Section title="States">
        <DemoDial id="alpha" channels={RINGED_ENCODER_CHANNELS_WITH_ALPHA} label="Accent" rings={2} size={200} />
        <DemoDial id="disabled" disabled label="Lights" rings={3} size={200} />
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
    gap: 32,
  },
  figure: {
    margin: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  caption: {
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    opacity: 0.6,
  },
};
