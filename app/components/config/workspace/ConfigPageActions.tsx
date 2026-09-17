"use client";

import { ArrowLeft, LogOut } from "lucide-react";
import { DEMO_CONFIG_STORAGE_KEY, DEMO_THEME_STORAGE_KEY, DEMO_THEME_LIBRARY_STORAGE_KEY } from "../../../../lib/demo-config";
import { AUTHENTIK_INVALIDATION_URL, isDemoMode } from "./constants";

async function signOut() {
  if (isDemoMode) {
    for (const key of [DEMO_CONFIG_STORAGE_KEY, DEMO_THEME_STORAGE_KEY, DEMO_THEME_LIBRARY_STORAGE_KEY, "nova.demo.design.v1"]) window.sessionStorage.removeItem(key);
    window.localStorage.removeItem("nova.demo.provider.v1");
    window.location.href = `${process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH ?? ""}/`;
    return;
  }
  try {
    await fetch("/outpost.goauthentik.io/sign_out", { credentials: "include", redirect: "manual" });
  } catch (error) {
    // An opaque-redirect rejection here is expected and harmless; the cookie is
    // cleared by the response regardless. Anything else still must not block
    // the invalidation navigation below, which is the half that matters.
    console.warn("[nova-dashboard] outpost sign-out did not complete cleanly", error);
  }
  window.location.href = AUTHENTIK_INVALIDATION_URL;
}

export function ConfigPageActions({ onBack }: { onBack: () => void }) {
  return (
    <>
      <button
        type="button"
        className="config-page-button icon-link-text-tone"
        aria-label="Back to dashboard"
        onClick={onBack}
      >
        <ArrowLeft className="h-5 w-5" />
        Back
      </button>
      <button
        type="button"
        className="config-page-button icon-link-text-tone"
        aria-label={isDemoMode ? "Reset demo" : "Log out"}
        onClick={() => void signOut()}
      >
        <LogOut className="h-5 w-5" />
        {isDemoMode ? "Reset demo" : "Log out"}
      </button>
    </>
  );
}
