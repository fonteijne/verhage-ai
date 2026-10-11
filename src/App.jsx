import { useCallback, useEffect, useRef, useState } from 'react';
import { startSession, sendMessage, euro } from './lib/api.js';
import { gsap, useGSAP, reducedMotion } from './lib/motion.js';
import { useLenis } from './lib/smoothScroll.js';
import ClickSpark from './components/bits/ClickSpark.jsx';
import ShinyText from './components/bits/ShinyText.jsx';
import QuickStarts from './components/QuickStarts.jsx';
import ChatMessage from './components/ChatMessage.jsx';
import CartPanel from './components/CartPanel.jsx';
import Composer from './components/Composer.jsx';

/** Shows which provider is answering, and on which model. */
function AgentBadge({ agent }) {
  if (!agent) return null;
  const live = agent.id !== 'fallback' && agent.id !== 'error';
  const title = agent.error || (agent.model ? `Model: ${agent.model}` : undefined);
  return (
    <span className={`agent-badge ${live ? 'live' : ''} ${agent.id === 'error' ? 'bad' : ''}`} title={title}>
      {agent.label}
      {live && agent.model && <em>{agent.model}</em>}
      {agent.id === 'fallback' && <em>geen API-key</em>}
    </span>
  );
}

const PAGE_LENIS = { prevent: (node) => Boolean(node.closest?.('.messages, .cart')) };

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
  const [cartOpen, setCartOpen] = useState(false);
  const app = useRef(null);
  const scroller = useRef(null);
  const messagesInner = useRef(null);

  // Smooth scrolling for the page (mobile) and, separately, the message list.
  useLenis(null, null, PAGE_LENIS);
  const chatScroll = useLenis(scroller, messagesInner);

  // Page entrance.
  useGSAP(
    () => {
      if (reducedMotion()) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out', clearProps: 'transform,opacity' } });
      tl.from('.topbar', { yPercent: -100, duration: 0.7 })
        .from('.brand-mark', { scale: 0, rotation: -90, duration: 0.8, ease: 'back.out(2)' }, '<0.2')
        .from('.chat', { opacity: 0, y: 36, duration: 0.8 }, '<0.1');
      // On narrow screens the cart is an off-canvas sheet; leave it to CSS.
      if (!window.matchMedia('(max-width: 900px)').matches) {
        tl.from('.cart', { opacity: 0, y: 36, duration: 0.8 }, '<0.12');
      }
    },
    { scope: app }
  );

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
    const el = scroller.current;
    if (!el) return;
    const lenis = chatScroll.current;
    if (lenis) {
      lenis.resize();
      lenis.scrollTo(lenis.limit, { duration: 0.9 });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }, [messages, busy, chatScroll]);

  useEffect(() => {
    if (!cartOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setCartOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cartOpen]);

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
    <ClickSpark sparkColor="#f5a623" sparkSize={11} sparkRadius={20} sparkCount={9} duration={450}>
    <div className="app" ref={app}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">V</span>
          <div>
            <h1>{session?.store?.name || 'Verhage'}</h1>
            <p>Bestellen via de chat{session?.store?.pickupOnly ? ' · alleen afhalen' : ''}</p>
          </div>
        </div>
        <AgentBadge agent={session?.agent} />
      </header>

      <main className="layout">
        <section className="chat" aria-label="Gesprek">
          <div className="messages" ref={scroller}>
            <div className="messages-inner" ref={messagesInner} aria-live="polite">
              {messages.map((m, i) => (
                <ChatMessage key={i} message={m} onSend={send} disabled={busy} />
              ))}
              {busy && (
                <div className="msg assistant">
                  <div className="bubble typing" role="status">
                    <span className="dots" aria-hidden="true"><span /><span /><span /></span>
                    <ShinyText text="Even kijken in het assortiment…" color="#8a7d75" shineColor="#d81f26" speed={2.2} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {messages.length <= 1 && !busy && session && (
            <QuickStarts items={QUICK_STARTS} onSend={send} disabled={busy} />
          )}

          {error && <p className="error" role="alert">{error}</p>}
          <Composer onSend={send} disabled={busy || !session} />
        </section>

        <CartPanel cart={cart} onSend={send} disabled={busy} open={cartOpen} onClose={() => setCartOpen(false)} />
      </main>

      <button className="cart-bar" onClick={() => setCartOpen(true)} aria-label="Bekijk je bestelling">
        <span>Je bestelling{cart.itemCount ? ` · ${cart.itemCount}` : ''}</span>
        <strong>{euro(cart.subtotal || 0)}</strong>
      </button>
      <div className={`scrim ${cartOpen ? 'show' : ''}`} onClick={() => setCartOpen(false)} />
    </div>
    </ClickSpark>
  );
}
