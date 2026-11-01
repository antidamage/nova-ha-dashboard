import { describe, expect, it } from "vitest";
import { prefersNativeHls } from "./hls-engine-model";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const EDGE = `${CHROME} Edg/156.0.0.0`;
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME_ON_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.0.0 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

describe("prefersNativeHls", () => {
  it("uses WebKit's native engine, including Chrome on iOS, which is WebKit", () => {
    expect(prefersNativeHls("maybe", SAFARI)).toBe(true);
    expect(prefersNativeHls("maybe", IPHONE)).toBe(true);
    expect(prefersNativeHls("maybe", CHROME_ON_IOS)).toBe(true);
  });

  it("keeps Chromium on hls.js even though it answers maybe", () => {
    expect(prefersNativeHls("maybe", CHROME)).toBe(false);
    expect(prefersNativeHls("maybe", EDGE)).toBe(false);
  });

  it("uses hls.js where the browser has no native engine", () => {
    expect(prefersNativeHls("", SAFARI)).toBe(false);
    expect(prefersNativeHls("", FIREFOX)).toBe(false);
  });
});
