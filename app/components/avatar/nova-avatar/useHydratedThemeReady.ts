"use client";

import { useEffect, useState } from "react";
import type { NovaAvatarTheme } from "../theme-model/types";

export function useHydratedThemeReady({
  themeOverride,
  themeReady,
}: {
  themeOverride: NovaAvatarTheme | undefined;
  themeReady: boolean;
}) {
  // Two-pass hydration guard — the actual fix for the long-standing "gym number
  // is transparent (a translucent black) after a reload" bug. The host div sets
  // suppressHydrationWarning because its theme-derived output comes from a
  // client-only localStorage read the server can't see, and the page is
  // force-static so the server prerenders the digit transparent (themeReady
  // false, no data/ dir at build). On a *warm* reload the client's first render
  // instead computes themeReady=true from the warm shared-theme cache — a
  // mismatch. Because of suppressHydrationWarning React keeps the stale server
  // DOM AND treats the client's (correct) values as its committed baseline, so
  // no later state change ever diffs the digit back into view: it stays
  // transparent forever even though the React state is perfect. (A cold load
  // works only because its first render also computes false, matching the
  // server, so the later false->true flip is a real diff that repaints.)
  //
  // Starting `hydrated` false makes the first client render match the server
  // (transparent), then flipping it in a mount effect guarantees a genuine
  // false->true transition React must reconcile — forcing the saved gym colour
  // to actually paint. Overrides (config preview) are unaffected.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const gymColorReady = themeOverride !== undefined || (hydrated && themeReady);
  return { hydrated, gymColorReady };
}
