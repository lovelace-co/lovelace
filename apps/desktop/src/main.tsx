import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TauriHost } from './lib/host';
import { HostProvider } from './state/store';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HostProvider host={new TauriHost()}>
        <App />
      </HostProvider>
    </StrictMode>,
  );
}
