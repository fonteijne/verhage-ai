import { useRef } from 'react';
import { gsap, useGSAP, reducedMotion } from '../lib/motion.js';

export default function QuickStarts({ items, onSend, disabled }) {
  const root = useRef(null);

  useGSAP(
    () => {
      if (reducedMotion()) return;
      gsap.from('button', { opacity: 0, y: 14, scale: 0.9, stagger: 0.07, delay: 0.5, duration: 0.5, ease: 'back.out(1.7)', clearProps: 'transform,opacity' });
    },
    { scope: root }
  );

  return (
    <div className="quickstarts" ref={root}>
      {items.map((q) => (
        <button key={q} onClick={() => onSend(q)} disabled={disabled}>{q}</button>
      ))}
    </div>
  );
}
