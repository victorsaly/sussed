import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerProvider } from '@sussed/player/react';
import { registerServiceWorker } from '@sussed/pwa';
import { App } from './App';
import '@sussed/ui/tokens.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');

createRoot(root).render(
  <StrictMode>
    <PlayerProvider
      options={{
        game: 'bridges',
        baseUrl: import.meta.env.VITE_PLAYERS_URL ?? 'https://api.sussed.games',
        sync: import.meta.env.VITE_SYNC !== 'false',
      }}
    >
      <App />
    </PlayerProvider>
  </StrictMode>,
);

registerServiceWorker();
