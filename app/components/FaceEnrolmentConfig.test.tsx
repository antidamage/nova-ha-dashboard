import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FaceEnrolmentConfig,
  anglePrompt,
  faceReasonMessage,
  looksLikeCaptureCard,
  pickPreferredCamera,
} from "./FaceEnrolmentConfig";

type StubTrack = { stop: ReturnType<typeof vi.fn> };

function stubStream(tracks: StubTrack[]) {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { value, configurable: true, writable: true });
}

/**
 * ConfigAccordion restores its expanded state from session storage on mount,
 * asynchronously. Clicking unconditionally would therefore *close* the section
 * in whichever test happens to run after one that left it open, so this waits
 * for the restore to settle and only clicks when it is still collapsed.
 */
async function openSection() {
  const { act, fireEvent } = await import("@testing-library/react");
  const trigger = screen.getByRole("button", { name: /^face enrolment$/i });
  await act(async () => { await Promise.resolve(); });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(trigger);
  }
  await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
}

describe("camera preference", () => {
  it("prefers a webcam over an MS2109 capture grabber", () => {
    // The grabber is listed first deliberately: without the preference the
    // browser's own default ordering would win and enrolment would bind the
    // outdoor security camera.
    const devices = [
      { deviceId: "grabber", label: "MACROSILICON USB Video (534d:2109)" },
      { deviceId: "webcam", label: "IMC Networks USB2.0 HD UVC WebCam" },
    ];
    expect(pickPreferredCamera(devices)?.deviceId).toBe("webcam");
    expect(looksLikeCaptureCard(devices[0].label)).toBe(true);
    expect(looksLikeCaptureCard(devices[1].label)).toBe(false);
  });

  it("falls back to enumeration order when no label says anything", () => {
    const devices = [{ deviceId: "a", label: "" }, { deviceId: "b", label: "" }];
    expect(pickPreferredCamera(devices)?.deviceId).toBe("a");
    expect(pickPreferredCamera([])).toBeUndefined();
  });
});

describe("prompts and refusal strings", () => {
  it("walks the five angles in order and then repeats a generic prompt", () => {
    expect(anglePrompt(0)).toBe("Look straight at the camera.");
    expect(anglePrompt(4)).toBe("Tilt your chin down a little.");
    expect(anglePrompt(5)).toBe("One more from any angle.");
  });

  it("renders the spec's strings and collapses the signals it must not disclose", () => {
    expect(faceReasonMessage("multiple_faces")).toBe("More than one face in frame.");
    // Same text on purpose: which signal caught a spoof is calibration data,
    // not something to hand back to whoever is being caught.
    expect(faceReasonMessage("antispoof")).toBe(faceReasonMessage("liveness_rigid"));
    expect(faceReasonMessage("locked_out")).toBe(faceReasonMessage("disarmed"));
    expect(faceReasonMessage("rate_limited")).toBe(faceReasonMessage("disarmed"));
    expect(faceReasonMessage("something_new")).toBe("That clip was refused.");
  });
});

describe("FaceEnrolmentConfig", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("explains an insecure origin instead of letting getUserMedia throw", async () => {
    setSecureContext(false);
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });

    render(<FaceEnrolmentConfig />);
    await openSection();

    expect(await screen.findByText(/Camera access needs the HTTPS address\./)).toBeTruthy();
    // No camera affordance is offered at all — an insecure origin has no camera
    // API to offer it against.
    expect(screen.queryByRole("button", { name: /start camera/i })).toBeNull();
  });

  it("stops every media track when the section unmounts", async () => {
    setSecureContext(true);
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn(async () => stubStream([track]));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: vi.fn(async () => [
          { deviceId: "webcam", kind: "videoinput", label: "IMC Networks USB2.0 HD UVC WebCam" },
        ]),
      },
    });

    const { fireEvent } = await import("@testing-library/react");
    const view = render(<FaceEnrolmentConfig />);
    await openSection();

    fireEvent.click(screen.getByRole("button", { name: /start camera/i }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await screen.findByRole("button", { name: /stop camera/i });

    // Unmount stands in for both closing the page and collapsing the accordion:
    // ConfigAccordion renders its body only while open, so a collapse unmounts
    // this component and takes the same cleanup path.
    view.unmount();
    await waitFor(() => expect(track.stop).toHaveBeenCalled());
  });
});
