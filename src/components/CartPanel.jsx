import { useRef } from 'react';
import { euro } from '../lib/api.js';
import { gsap, useGSAP, reducedMotion } from '../lib/motion.js';
import AnimatedPrice from './AnimatedPrice.jsx';

/** One cart line. Flashes when it first appears or its quantity changes. */
function CartLine({ item, onSend, disabled }) {
  const li = useRef(null);
  const prevQty = useRef(item.quantity);
  const flash = () =>
    gsap.fromTo(
      li.current,
      { backgroundColor: 'rgba(245, 166, 35, .38)' },
      { backgroundColor: 'rgba(245, 166, 35, 0)', duration: 1.4, ease: 'power2.out', clearProps: 'backgroundColor' }
    );

  useGSAP(
    () => {
      if (reducedMotion()) return;
      gsap.from(li.current, { opacity: 0, x: 28, duration: 0.5, ease: 'power3.out' });
      flash();
    },
    { scope: li }
  );

  useGSAP(
    () => {
      if (prevQty.current === item.quantity) return;
      prevQty.current = item.quantity;
      if (reducedMotion()) return;
      flash();
      gsap.fromTo('.qty', { scale: 1.5 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, .5)' });
    },
    { scope: li, dependencies: [item.quantity] }
  );

  return (
    <li ref={li}>
      <span className="qty">{item.quantity}×</span>
      <span className="name">
        {item.name}
        {item.note && <em className="note">{item.note}</em>}
        {item.priceFrom && <em className="note">prijs vanaf — keuzes nog open</em>}
      </span>
      <span className="line-total">{euro(item.lineTotal)}</span>
      <button
        className="line-remove"
        aria-label={`${item.name} verwijderen`}
        disabled={disabled}
        onClick={() => onSend(`Haal ${item.name} uit mijn bestelling`)}
      >
        ×
      </button>
    </li>
  );
}

/** Count badge that pops whenever the number of items changes. */
function CountBadge({ count }) {
  const el = useRef(null);
  const prev = useRef(count);

  useGSAP(
    () => {
      if (prev.current !== count && !reducedMotion()) {
        gsap.fromTo(el.current, { scale: 1.8 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, .45)' });
      }
      prev.current = count;
    },
    { dependencies: [count] }
  );

  return <span className="count" ref={el}>{count}</span>;
}

/** Empty-state bag that gently floats. */
function EmptyBag() {
  const el = useRef(null);
  useGSAP(
    () => {
      if (reducedMotion()) return;
      gsap.to(el.current, { y: -6, rotation: 2, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
    },
    { scope: el }
  );
  return (
    <svg ref={el} className="empty-bag" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M12 16h24l2 24a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2l2-24Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M17 20v-4a7 7 0 0 1 14 0v4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The cart is read-only here on purpose: every change goes through the agent,
 * so the chat stays the single source of truth. Checkout is shown but disabled
 * — the app has no ordering or payment capability at all.
 *
 * On narrow screens it becomes a bottom sheet, opened from the cart bar.
 */
export default function CartPanel({ cart, onSend, disabled, open, onClose }) {
  const empty = !cart.items?.length;

  return (
    <aside className={`cart ${open ? 'open' : ''}`} aria-label="Bestelling">
      <div className="cart-head">
        <h2>Je bestelling</h2>
        {!empty && <CountBadge count={cart.itemCount} />}
        <button className="cart-close" onClick={onClose} aria-label="Sluit bestelling">×</button>
      </div>

      {empty ? (
        <div className="cart-empty">
          <EmptyBag />
          <p>Nog niets toegevoegd. Vraag het de assistent in de chat.</p>
        </div>
      ) : (
        <ul className="cart-lines">
          {cart.items.map((item) => (
            <CartLine key={item.lineId} item={item} onSend={onSend} disabled={disabled} />
          ))}
        </ul>
      )}

      <div className="cart-total">
        <span>Subtotaal{cart.estimated ? ' (indicatie)' : ''}</span>
        <strong><AnimatedPrice value={cart.subtotal || 0} /></strong>
      </div>

      <button className="checkout" disabled title="Afrekenen is in deze demo niet mogelijk">
        Afrekenen
      </button>
      <p className="checkout-note">
        Deze assistent vult alleen je mandje. Afrekenen, bestellen en betalen kunnen hier niet —
        dat doe je in de Verhage-webshop of in de winkel.
      </p>
    </aside>
  );
}
