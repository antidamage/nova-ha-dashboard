/** Static demo media lives with the fictional household fixtures. */
export function demoAssetUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_NOVA_DEMO_PROVIDER_BASE ?? "https://antidamage.github.io/nova-dummy-data-provider/";
  return new URL(path, base.endsWith("/") ? base : `${base}/`).href;
}
