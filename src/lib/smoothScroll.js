import { useEffect, useRef } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap, reducedMotion } from './motion.js';

/**
 * Lenis smooth scrolling, driven by GSAP's ticker so scroll and tweens share
 * one clock. Pass a wrapper/content ref pair for a scrollable panel, or
 * nothing for the document. Does nothing under prefers-reduced-motion.
 *
 * `options` are passed to Lenis (the page instance uses `prevent` to leave the
 * message list to its own instance).
 *
 * Returns a ref holding the Lenis instance (null when disabled).
 */
export function useLenis(wrapperRef, contentRef, options) {
  const lenisRef = useRef(null);

  useEffect(() => {
    if (reducedMotion()) return undefined;

    const lenis = new Lenis({
      ...(wrapperRef && { wrapper: wrapperRef.current, content: contentRef.current }),
      autoRaf: false,
      ...options,
      lerp: 0.1,
    });
    const tick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    lenisRef.current = lenis;

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [wrapperRef, contentRef]);

  return lenisRef;
}
