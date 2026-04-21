const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#111111"/>
  <path d="M8 10h48v44H8z" fill="none" stroke="#22d3ee" stroke-width="4"/>
  <path d="M18 42 32 14l14 28H18z" fill="none" stroke="#f0e442" stroke-width="4"/>
  <path d="M22 48h20" stroke="#d946ef" stroke-width="4"/>
</svg>`;

export function GET() {
  return new Response(icon, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
