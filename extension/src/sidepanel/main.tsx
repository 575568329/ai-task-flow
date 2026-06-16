// extension/src/sidepanel/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel.js';
import { PageContextProvider } from './PageContextStore.js';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <React.StrictMode>
    <PageContextProvider>
      <SidePanel />
    </PageContextProvider>
  </React.StrictMode>,
);
