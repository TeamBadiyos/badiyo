// Top-down delivery bike marker that can face the road direction.
// Google Maps image icons can't rotate, so the rotation is baked into the SVG.

export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x =
    Math.cos(a.lat * r) * Math.sin(b.lat * r) -
    Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Shortest-turn interpolation between two headings. */
export function lerpAngle(from: number, to: number, k: number) {
  const d = ((to - from + 540) % 360) - 180;
  return (from + d * k + 360) % 360;
}

/** Bike faces up (north) at angle 0. */
export function bikeIconUrl(angle: number) {
  const a = Math.round(angle);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<ellipse cx="33" cy="34" rx="13" ry="24" fill="rgba(0,0,0,0.18)" transform="rotate(${a} 32 32)"/>
<g transform="rotate(${a} 32 32)">
<rect x="29" y="6" width="6" height="11" rx="3" fill="#20242D"/>
<rect x="29" y="47" width="6" height="11" rx="3" fill="#20242D"/>
<rect x="21" y="14" width="22" height="3.5" rx="1.75" fill="#20242D"/>
<path d="M26 16 Q32 12 38 16 L38 44 Q32 48 26 44 Z" fill="#00B97A" stroke="#fff" stroke-width="1.5"/>
<rect x="22.5" y="38" width="19" height="16" rx="3" fill="#FFB020" stroke="#fff" stroke-width="1.5"/>
<rect x="24.5" y="44.5" width="15" height="2" rx="1" fill="rgba(0,0,0,0.18)"/>
<ellipse cx="32" cy="29" rx="7" ry="6" fill="#0E7A55"/>
<circle cx="32" cy="24" r="5.2" fill="#fff" stroke="#20242D" stroke-width="1.5"/>
<path d="M28.5 21.5 Q32 19 35.5 21.5" stroke="#20242D" stroke-width="1.6" fill="none"/>
<circle cx="32" cy="8.5" r="1.8" fill="#FFE68A"/>
</g></svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
