import React from 'react';
import ReactDOM from 'react-dom/client';
import { API_PREFIX } from '@tglobal/shared';
import './index.css';

function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6">
      <section className="w-full rounded-2xl border border-emerald-900/10 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-800">TGlobal</p>
        <h1 className="mt-3 text-3xl font-semibold">Gold Loan Portal</h1>
        <p className="mt-2 text-slate-600">Workspace scaffold is ready.</p>
        <p className="mt-6 text-sm text-slate-500">API base: {API_PREFIX}</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
