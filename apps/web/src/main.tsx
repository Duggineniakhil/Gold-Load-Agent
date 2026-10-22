import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/geist';
import './index.css';
import { ApplyPage } from './pages/apply';
import { HomePage } from './pages/home';
import { LeadsPage } from './pages/leads';
import { AppShell } from './shell';

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </AppShell>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
