import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerProvider } from '@sussed/player/react';
import { registerServiceWorker } from '@sussed/pwa';
import { App } from './App';
import '@sussed/ui/tokens.css';
import '@sussed/ui/identity.css';
import './styles.css';

// The game's hue: identity.css keys every accent off this one attribute.
document.documentElement.dataset.game = 'slitherlink';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');

createRoot(root).render(
  <StrictMode>
    <PlayerProvider
      options={{
        game: 'loop',
        baseUrl: import.meta.env.VITE_PLAYERS_URL ?? 'https://api.sussed.games',
        sync: import.meta.env.VITE_SYNC !== 'false',
      }}
    >
      <App />
    </PlayerProvider>
  </StrictMode>,
);

registerServiceWorker(`${import.meta.env.BASE_URL}sw.js`);
