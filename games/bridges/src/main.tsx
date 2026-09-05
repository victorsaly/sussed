import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerProvider } from '@sussed/player/react';
import { registerServiceWorker } from '@sussed/pwa';
import { App } from './App';
import '@sussed/ui/tokens.css';
import '@sussed/ui/identity.css';
import './styles.css';

// The game's hue: identity.css keys every accent off this one attribute.
document.documentElement.dataset.game = 'bridges';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');

createRoot(root).render(
  <StrictMode>
    <PlayerProvider
      options={{
        game: 'bridges',
        baseUrl: import.meta.env.VITE_PLAYERS_URL ?? 'https://api.sussed.games',
        // Sync is off until a players service is actually pointed at. The
        // default host above is not bought and nothing is deployed behind it,
        // so leaving this on meant every session firing requests at a domain
        // that does not resolve — swallowed by design, and pure noise. Set
        // VITE_PLAYERS_URL at build time to turn it on.
        sync: Boolean(import.meta.env.VITE_PLAYERS_URL) && import.meta.env.VITE_SYNC !== 'false',
      }}
    >
      <App />
    </PlayerProvider>
  </StrictMode>,
);

registerServiceWorker(`${import.meta.env.BASE_URL}sw.js`);
