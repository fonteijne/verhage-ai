import { useCallback, useEffect, useRef, useState } from 'react';
import { startSession, sendMessage } from './lib/api.js';
import ChatMessage from './components/ChatMessage.jsx';
import CartPanel from './components/CartPanel.jsx';
import Composer from './components/Composer.jsx';

const QUICK_STARTS = [
  'Ik wil graag een cheeseburger',
  'Wat hebben jullie vegetarisch?',
  'Twee frites met mayo',
  'Iets glutenvrij graag',
];

export default function App() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [cart, setCart] = useState({ items: [], itemCount: 0, subtotal: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const scroller = useRef(null);

  useEffect(() => {
    startSession()
      .then((s) => {
        setSession(s);
        setCart(s.cart);
        setMessages([{ role: 'assistant', text: s.greeting }]);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = useCallback(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || !session || busy) return;

      setMessages((m) => [...m, { role: 'user', text: trimmed }]);
      setBusy(true);
      setError(null);
      try {
        const res = await sendMessage(session.sessionId, trimmed);
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: res.reply,
            products: res.products,
            suggestions: res.suggestions,
            events: res.events,
          },
        ]);
        if (res.cart) setCart(res.cart);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [session, busy]
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">V</span>
          <div>
            <h1>{session?.store?.name || 'Verhage'}</h1>
            <p>Bestellen via de chat{session?.store?.pickupOnly ? ' · alleen afhalen' : ''}</p>
          </div>
        </div>
        <span className={`agent-badge ${session?.agent === 'claude' ? 'live' : ''}`}>
          {session?.agent === 'claude' ? 'Claude-agent' : 'Regel-agent (geen API-key)'}
        </span>
      </header>

      <main className="layout">
        <section className="chat" aria-label="Gesprek">
          <div className="messages" ref={scroller}>
            {messages.map((m, i) => (
              <ChatMessage key={i} message={m} onSend={send} disabled={busy} />
            ))}
            {busy && (
              <div className="msg assistant">
                <div className="bubble typing" aria-label="Assistent typt">
                  <span /><span /><span />
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && !busy && (
            <div className="quickstarts">
              {QUICK_STARTS.map((q) => (
                <button key={q} onClick={() => send(q)} disabled={busy}>{q}</button>
              ))}
            </div>
          )}

          {error && <p className="error" role="alert">{error}</p>}
          <Composer onSend={send} disabled={busy || !session} />
        </section>

        <CartPanel cart={cart} onSend={send} disabled={busy} />
      </main>
    </div>
  );
}
