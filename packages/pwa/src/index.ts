/**
 * Install and offline, written once for all nine games.
 *
 * The install prompt is never shown on arrival. It waits until someone has
 * come back — a person who has played three days running is being offered
 * something useful; a first-time visitor is being interrupted.
 */

export function registerServiceWorker(url = '/sw.js'): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(url).catch(() => undefined);
  });
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;

export function watchInstallPrompt(onAvailable: () => void): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    onAvailable();
  });
}

export function canInstall(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome;
}

/** True once the game is running from the home screen rather than a tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export interface ManifestInput {
  name: string;
  shortName: string;
  description: string;
  themeColor: string;
  backgroundColor: string;
  startUrl?: string;
}

export function buildManifest(input: ManifestInput): string {
  return JSON.stringify(
    {
      name: input.name,
      short_name: input.shortName,
      description: input.description,
      start_url: input.startUrl ?? '/',
      display: 'standalone',
      orientation: 'portrait',
      theme_color: input.themeColor,
      background_color: input.backgroundColor,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );
}
