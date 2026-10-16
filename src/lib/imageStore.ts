/**
 * Persistent on-device image copies for Command Center photos.
 * Native app: each URL is downloaded once into app storage and rendered from the local file.
 * Web: falls back to the original URL (browser cache).
 */
const MANIFEST_KEY = "bdy_img_store_v1";
type Manifest = Record<string, string>; // remote url -> webview-local src

let manifest: Manifest | null = null;
function load(): Manifest {
  if (manifest) return manifest;
  if (typeof window === "undefined") return {};
  try { manifest = JSON.parse(window.localStorage.getItem(MANIFEST_KEY) || "{}") as Manifest; } catch { manifest = {}; }
  return manifest!;
}
function save() {
  try { window.localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest ?? {})); } catch { /* full */ }
}

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** Synchronous: local copy if we have one, else the remote URL. Safe during render. */
export function localSrc(url: string): string {
  if (!url) return url;
  return load()[url] ?? url;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

const inflight = new Map<string, Promise<void>>();

/** Download any missing URLs to device storage (native only). Removes files no longer in `keep`. */
export async function syncImages(urls: string[], keep?: string[]): Promise<void> {
  if (!isNative()) return;
  const m = load();
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Capacitor } = await import("@capacitor/core");
  await Promise.all(urls.filter((u) => u && !m[u]).map((u) => {
    if (inflight.has(u)) return inflight.get(u)!;
    const p = (async () => {
      try {
        const resp = await fetch(u);
        if (!resp.ok) return;
        const data = await blobToBase64(await resp.blob());
        const ext = (u.split("?")[0].match(/\.(png|jpe?g|webp|gif|avif)$/i)?.[1] ?? "img").toLowerCase();
        const path = `img/${hash(u)}.${ext}`;
        const w = await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
        m[u] = Capacitor.convertFileSrc(w.uri);
        save();
      } catch { /* keep remote */ }
      finally { inflight.delete(u); }
    })();
    inflight.set(u, p);
    return p;
  }));
  if (keep) {
    const keepSet = new Set(keep);
    const stale = Object.keys(m).filter((u) => !keepSet.has(u));
    for (const u of stale) {
      const name = `img/${hash(u)}`;
      delete m[u];
      try {
        const dir = await Filesystem.readdir({ path: "img", directory: Directory.Data });
        for (const f of dir.files) if (f.name.startsWith(name.slice(4) + ".")) await Filesystem.deleteFile({ path: `img/${f.name}`, directory: Directory.Data });
      } catch { /* ignore */ }
    }
    if (stale.length) save();
  }
}
