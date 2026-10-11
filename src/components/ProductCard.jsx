import { useState } from 'react';
import { euro } from '../lib/api.js';
import { gsap, useGSAP, reducedMotion } from '../lib/motion.js';
import SpotlightCard from './bits/SpotlightCard.jsx';

export default function ProductCard({ product, onSend, disabled }) {
  // Product shots come from the Verhage CDN; if one is unavailable the card
  // should read as a clean text card rather than a grey hole.
  const [imageOk, setImageOk] = useState(Boolean(product.thumbnail || product.image));

  // Hover lift runs through GSAP rather than a CSS transform transition, which
  // would fight the entrance tween that animates the same element.
  const { contextSafe } = useGSAP();
  const lift = contextSafe((e, y) => {
    if (reducedMotion()) return;
    gsap.to(e.currentTarget, { y, duration: 0.3, ease: 'power3.out', overwrite: 'auto' });
  });

  return (
    <SpotlightCard
      onPointerEnter={(e) => e.pointerType === 'mouse' && lift(e, -3)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && lift(e, 0)}
      theme="light"
      spotlightColor="#f5a623"
      intensity={0.7}
      spotlightSize={170}
      borderGlow={0.9}
      className={`product-card ${imageOk ? '' : 'no-image'}`}
    >
      {imageOk && (
        <div className="product-img">
          <img
            src={product.thumbnail || product.image}
            alt=""
            loading="lazy"
            onError={() => setImageOk(false)}
          />
        </div>
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
        <span aria-hidden="true">+</span> Toevoegen
      </button>
    </SpotlightCard>
  );
}
