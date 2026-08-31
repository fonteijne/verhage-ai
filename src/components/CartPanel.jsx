import { euro } from '../lib/api.js';

/**
 * The cart is read-only here on purpose: every change goes through the agent,
 * so the chat stays the single source of truth. Checkout is shown but disabled
 * — the app has no ordering or payment capability at all.
 */
export default function CartPanel({ cart, onSend, disabled }) {
  const empty = !cart.items?.length;

  return (
    <aside className="cart" aria-label="Bestelling">
      <div className="cart-head">
        <h2>Je bestelling</h2>
        {!empty && <span className="count">{cart.itemCount}</span>}
      </div>

      {empty ? (
        <p className="cart-empty">Nog niets toegevoegd. Vraag het de assistent in de chat.</p>
      ) : (
        <ul className="cart-lines">
          {cart.items.map((item) => (
            <li key={item.lineId}>
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
          ))}
        </ul>
      )}

      <div className="cart-total">
        <span>Subtotaal{cart.estimated ? ' (indicatie)' : ''}</span>
        <strong>{euro(cart.subtotal || 0)}</strong>
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
