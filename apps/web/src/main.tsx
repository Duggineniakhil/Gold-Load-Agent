import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/geist';
import './index.css';
import { ApplyPage } from './pages/apply';
import { HomePage } from './pages/home';
import { AdminPage } from './pages/admin';
import { CalculatorPage } from './pages/calculator';
import { AppShell } from './shell';

/** The register moved to /admin; keep old links (and their ?planId=) working. */
function LegacyLeadsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/admin${search}`} replace />;
}

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="/calculator" element={<CalculatorPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/leads" element={<LegacyLeadsRedirect />} />
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
