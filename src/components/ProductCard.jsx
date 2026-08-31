import { useState } from 'react';
import { euro } from '../lib/api.js';

export default function ProductCard({ product, onSend, disabled }) {
  // Product shots come from the Verhage CDN; if one is unavailable the card
  // should read as a clean text card rather than a grey hole.
  const [imageOk, setImageOk] = useState(Boolean(product.thumbnail || product.image));

  return (
    <article className={`product-card ${imageOk ? '' : 'no-image'}`}>
      {imageOk && (
        <img
          src={product.thumbnail || product.image}
          alt=""
          loading="lazy"
          onError={() => setImageOk(false)}
        />
      )}
      <div className="product-body">
        <h4>{product.name}</h4>
        <p className="price">
          {product.hasOptions && <span className="from">vanaf </span>}
          {euro(product.price)}
        </p>
        {product.description && <p className="desc">{product.description}</p>}
        {product.allergens?.length > 0 && (
          <p className="allergens">Allergenen: {product.allergens.join(', ')}</p>
        )}
      </div>
      <button
        className="add"
        disabled={disabled}
        onClick={() => onSend(`Doe maar een ${product.name}`)}
      >
        Toevoegen
      </button>
    </article>
  );
}
