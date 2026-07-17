import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceTheme } from "./accentColor";
import {
  ConfigPreviewBackground,
  ConfigPreviewBackgroundProvider,
  useConfigPreviewBackground,
} from "./ConfigPreviewBackground";
import { writeExperienceFeatures } from "./dashboard/experienceModeSetting";

vi.mock("./FluidBackground", () => ({
  FluidBackground: () => <div data-testid="fluid-background" />,
}));

const previewTheme = {} as DeviceTheme;

function PublishPreviewTheme() {
  const preview = useConfigPreviewBackground();

  useEffect(() => {
    preview?.setPreviewTheme(previewTheme);
  }, [preview]);

  return null;
}

function renderPreview() {
  return render(
    <ConfigPreviewBackgroundProvider>
      <PublishPreviewTheme />
      <ConfigPreviewBackground />
    </ConfigPreviewBackgroundProvider>,
  );
}

describe("ConfigPreviewBackground", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-nova-lite");
    document.documentElement.removeAttribute("data-nova-no-orb");
  });

  it("does not mount the shader preview when the device background feature is disabled", async () => {
    writeExperienceFeatures({ background: false, camera: true, statusOrb: true, worldMap: true });

    renderPreview();

    await waitFor(() => expect(screen.queryByTestId("fluid-background")).not.toBeInTheDocument());
  });

  it("responds immediately when the device background feature changes", async () => {
    writeExperienceFeatures({ background: false, camera: true, statusOrb: true, worldMap: true });
    renderPreview();

    await waitFor(() => expect(screen.queryByTestId("fluid-background")).not.toBeInTheDocument());

    writeExperienceFeatures({ background: true, camera: true, statusOrb: true, worldMap: true });
    expect(await screen.findByTestId("fluid-background")).toBeInTheDocument();

    writeExperienceFeatures({ background: false, camera: true, statusOrb: true, worldMap: true });
    await waitFor(() => expect(screen.queryByTestId("fluid-background")).not.toBeInTheDocument());
  });
});
