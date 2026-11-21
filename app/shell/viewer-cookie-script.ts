// Copies the device's stored home user into the `nova-viewer` cookie before the
// page does anything else, so the first fetch and the first EventSource already
// carry it (specs/private-reminders.md, section 2). The storage key mirrors
// HOME_USER_STORAGE_KEY in app/components/home-users/homeUserSetting.ts.
export function viewerCookieScript(): string {
  return `
try {
  var viewerStored = window.localStorage.getItem("nova.dashboard.homeUser.v1");
  if (viewerStored && viewerStored.trim()) {
    document.cookie = "nova-viewer=" + encodeURIComponent(viewerStored) + "; Path=/; Max-Age=31536000; SameSite=Lax";
  } else {
    document.cookie = "nova-viewer=; Path=/; Max-Age=0; SameSite=Lax";
  }
} catch (error) {}
`;
}