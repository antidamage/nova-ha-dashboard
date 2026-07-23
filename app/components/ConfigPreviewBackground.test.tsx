import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_SET, type DeviceTheme } from "./accentColor";
import {
  ConfigPreviewBackground,
  ConfigPreviewBackgroundProvider,
  useConfigPreviewBackground,
} from "./ConfigPreviewBackground";
import { writeExperienceFeatures } from "./dashboard/experienceModeSetting";

vi.mock("./FluidBackground", () => ({
  FluidBackground: ({ theme }: { theme: DeviceTheme }) => (
    <div data-testid="fluid-background" data-accent={theme.accent?.rgb.join(",") ?? "published"} />
  ),
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

  it("renders the currently selected dashboard theme before the editor mounts", () => {
    const lightTheme = {
      ...DEFAULT_THEME_SET.themes.light,
      accent: { ...DEFAULT_THEME_SET.themes.light.accent, rgb: [12, 34, 56] as [number, number, number] },
    };

    render(
      <ConfigPreviewBackgroundProvider
        initialTheme={{ selection: "light", themes: { light: lightTheme } }}
      >
        <ConfigPreviewBackground />
      </ConfigPreviewBackgroundProvider>,
    );

    expect(screen.getByTestId("fluid-background")).toHaveAttribute("data-accent", "12,34,56");
  });

  it("keeps the latest theme visible when the editor releases its preview", async () => {
    function PublishThenRelease() {
      const preview = useConfigPreviewBackground();
      useEffect(() => {
        preview?.setPreviewTheme(previewTheme);
        preview?.setPreviewTheme(null);
      }, [preview]);
      return null;
    }

    render(
      <ConfigPreviewBackgroundProvider initialTheme={DEFAULT_THEME_SET}>
        <PublishThenRelease />
        <ConfigPreviewBackground />
      </ConfigPreviewBackgroundProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("fluid-background")).toBeInTheDocument());
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
