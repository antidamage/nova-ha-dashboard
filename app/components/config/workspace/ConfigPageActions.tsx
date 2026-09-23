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

/**
 * Icon-only, like `.dashboard-reload-link` beside them: the three buttons are
 * one fixed cluster at the top left of the config page, and a text label would
 * make the cluster reach into the category strip. The icon's name lives in its
 * aria-label, its tooltip, and the demo tooltip, in the same shape
 * ReloadButton / ThemeOverrideButton already use. Positioning is CSS
 * (`.dashboard-back-link` / `.dashboard-logout-link`, specs/config-page-header.md);
 * the class here is the shared fixed box.
 */
export function ConfigPageActions({ onBack }: { onBack: () => void }) {
  const signOutLabel = isDemoMode ? "Reset demo" : "Log out";
  return (
    <>
      <button
        type="button"
        className="dashboard-config-link dashboard-back-link"
        aria-label="Back to dashboard"
        title="Back to dashboard"
        data-demo-tooltip-title="Back"
        data-demo-tooltip="Leave configuration and go back to the dashboard."
        onClick={onBack}
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="dashboard-config-link dashboard-logout-link"
        aria-label={signOutLabel}
        title={signOutLabel}
        data-demo-tooltip-title={signOutLabel}
        data-demo-tooltip={isDemoMode ? "Clear this device's demo changes and start again." : "End the session and sign out."}
        onClick={() => void signOut()}
      >
        <LogOut className="h-5 w-5" aria-hidden="true" />
      </button>
    </>
  );
}
