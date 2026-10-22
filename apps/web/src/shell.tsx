import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { LoanAssistChat, useLoanAssist } from './loan-assist';
import { Icon } from './ui';

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/apply', label: 'Apply' },
  { to: '/leads', label: 'Lead register' },
  { to: '/#how-it-works', label: 'How it works' },
  { to: '/#faq', label: 'FAQ' },
];

const OpenAssistContext = createContext<(() => void) | null>(null);

/** Opens the Loan Assist sheet from anywhere inside the shell. */
export function useOpenAssist() {
  const open = useContext(OpenAssistContext);
  if (!open) throw new Error('useOpenAssist must be used inside AppShell.');
  return open;
}

/** Scrolls to #anchors after navigation (the router does not) and to the top on page changes. */
function useScrollOnNavigate() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    const frame = requestAnimationFrame(() =>
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const [assistOpen, setAssistOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const assist = useLoanAssist();
  const reduceMotion = useReducedMotion();
  const assistTrigger = useRef<HTMLButtonElement>(null);
  const assistClose = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useScrollOnNavigate();

  useEffect(() => setMenuOpen(false), [location.pathname, location.hash]);

  useEffect(() => {
    if (!assistOpen) return;
    const trigger = assistTrigger.current;
    assistClose.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAssistOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      trigger?.focus();
    };
  }, [assistOpen]);

  const isActive = (to: string, end?: boolean) => {
    if (to.includes('#')) return false;
    return end ? location.pathname === to && !location.hash : location.pathname.startsWith(to);
  };

  return (
    <div className="app-shell">
      <div className="nav-wrap">
        <nav className="nav" aria-label="Main navigation">
          <Link to="/" className="wordmark" aria-label="TGlobal home">
            TGlobal
          </Link>
          <ul className={`nav__links ${menuOpen ? 'is-open' : ''}`} id="nav-links">
            {links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={isActive(link.to, link.end) ? 'is-active' : ''}
                  aria-current={isActive(link.to, link.end) ? 'page' : undefined}
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <button
            ref={assistTrigger}
            type="button"
            className="nav__assist"
            onClick={() => setAssistOpen(true)}
          >
            <span>Ask Loan Assist</span>
            <span className="orb" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="nav__menu"
            aria-expanded={menuOpen}
            aria-controls="nav-links"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
          </button>
        </nav>
      </div>

      <OpenAssistContext.Provider value={() => setAssistOpen(true)}>
        <main className="main">{children}</main>
      </OpenAssistContext.Provider>

      <footer className="footer">
        <div className="footer__inner">
          <div>
            <span className="wordmark">TGlobal</span>
            <p>Preliminary gold-loan offers for field agents and borrowers.</p>
          </div>
          <nav aria-label="Footer">
            <Link to="/apply">Apply</Link>
            <Link to="/leads">Lead register</Link>
            <Link to="/#faq">FAQ</Link>
          </nav>
          <p className="footer__note">
            Offers are indicative and subject to physical verification of the gold.
          </p>
        </div>
      </footer>

      <AnimatePresence>
        {assistOpen && (
          <motion.div
            className="sheet-backdrop"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setAssistOpen(false);
            }}
          >
            <motion.aside
              className="assist-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="assist-heading"
              initial={reduceMotion ? false : { x: 24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { x: 16, opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.22 }}
            >
              <div className="assist-sheet__head">
                <div>
                  <span className="pill">
                    <Icon name="sparkle" />
                    AI assistant
                  </span>
                  <h2 id="assist-heading">Loan Assist</h2>
                  <p>Preliminary offers from today’s rate. Nothing is filed until you confirm.</p>
                </div>
                <button
                  ref={assistClose}
                  type="button"
                  className="icon-button"
                  onClick={() => setAssistOpen(false)}
                  aria-label="Close Loan Assist"
                >
                  <Icon name="close" />
                </button>
              </div>
              <LoanAssistChat chat={assist} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
