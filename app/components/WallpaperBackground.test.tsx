import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WallpaperBackground } from "./WallpaperBackground";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

describe("WallpaperBackground", () => {
  afterEach(() => {
    setViewport(originalInnerWidth, originalInnerHeight);
  });

  it("uses the landscape asset in a landscape window", () => {
    setViewport(1920, 1080);

    render(
      <WallpaperBackground
        wallpaper={{ landscapeAssetId: "wallpaper_landscape", portraitAssetId: "wallpaper_portrait", useAsDashboardBackground: true }}
      />,
    );

    const node = document.querySelector(".dashboard-wallpaper-background") as HTMLElement;
    expect(node.style.backgroundImage).toContain("/api/desktop/wallpapers/wallpaper_landscape");
  });

  it("uses the portrait asset in a portrait window", () => {
    setViewport(800, 1600);

    render(
      <WallpaperBackground
        wallpaper={{ landscapeAssetId: "wallpaper_landscape", portraitAssetId: "wallpaper_portrait", useAsDashboardBackground: true }}
      />,
    );

    const node = document.querySelector(".dashboard-wallpaper-background") as HTMLElement;
    expect(node.style.backgroundImage).toContain("/api/desktop/wallpapers/wallpaper_portrait");
  });

  it("falls back to whichever asset exists when the preferred orientation has none", () => {
    setViewport(800, 1600);

    render(
      <WallpaperBackground
        wallpaper={{ landscapeAssetId: "wallpaper_landscape", portraitAssetId: null, useAsDashboardBackground: true }}
      />,
    );

    const node = document.querySelector(".dashboard-wallpaper-background") as HTMLElement;
    expect(node.style.backgroundImage).toContain("/api/desktop/wallpapers/wallpaper_landscape");
  });

  it("renders nothing when neither asset is set", () => {
    setViewport(1920, 1080);

    render(
      <WallpaperBackground
        wallpaper={{ landscapeAssetId: null, portraitAssetId: null, useAsDashboardBackground: true }}
      />,
    );

    expect(document.querySelector(".dashboard-wallpaper-background")).not.toBeInTheDocument();
  });
});
