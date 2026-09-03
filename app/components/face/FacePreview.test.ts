import { describe, expect, it } from "vitest";
import { rotationForLabel, type CameraRotationRule } from "./FacePreview";

const RULES: CameraRotationRule[] = [{ match: "USB2.0 HD UVC WebCam", degrees: 90 }];

describe("rotationForLabel", () => {
  it("rotates only the camera the rule names", () => {
    // Keyed on the label rather than the host, so the rule follows the camera
    // and every other camera on every other device is left alone.
    expect(rotationForLabel("IMC Networks USB2.0 HD UVC WebCam", RULES)).toBe(90);
    expect(rotationForLabel("FaceTime HD Camera", RULES)).toBe(0);
    expect(rotationForLabel("MS2109 capture", RULES)).toBe(0);
  });

  it("matches case-insensitively, since labels are vendor strings", () => {
    expect(rotationForLabel("usb2.0 hd uvc webcam", RULES)).toBe(90);
  });

  it("is a no-op with no rules, no label, or an empty match", () => {
    expect(rotationForLabel("anything", [])).toBe(0);
    expect(rotationForLabel("", RULES)).toBe(0);
    expect(rotationForLabel("anything", [{ match: "", degrees: 90 } as CameraRotationRule])).toBe(0);
  });

  it("normalises the angle", () => {
    expect(rotationForLabel("x", [{ match: "x", degrees: 270 }])).toBe(270);
    expect(rotationForLabel("x", [{ match: "x", degrees: 0 }])).toBe(0);
  });
});
