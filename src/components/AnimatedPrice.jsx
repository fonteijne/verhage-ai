import { useRef } from 'react';
import { euro } from '../lib/api.js';
import { gsap, useGSAP, reducedMotion } from '../lib/motion.js';

/** A euro amount that counts to its new value instead of jumping. */
export default function AnimatedPrice({ value, className }) {
  const el = useRef(null);
  const shown = useRef({ v: value });

  useGSAP(
    () => {
      const write = () => { el.current.textContent = euro(shown.current.v); };
      if (reducedMotion()) {
        shown.current.v = value;
        write();
        return;
      }
      gsap.to(shown.current, { v: value, duration: 0.7, ease: 'power2.out', overwrite: true, onUpdate: write });
      write();
    },
    { dependencies: [value] }
  );

  return (
    <>
      <span ref={el} className={className} aria-hidden="true" />
      <span className="sr-only">{euro(value)}</span>
    </>
  );
}
