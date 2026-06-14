import { useEffect, useRef, useState } from 'react';

interface TypeOnProps {
  text: string;
  /** Characters revealed per second. */
  speed?: number;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Streams text in the way agent output arrives, with a soft caret while
 * it runs. Honours prefers-reduced-motion by rendering instantly.
 */
export function TypeOn({ text, speed = 900 }: TypeOnProps) {
  const instant = prefersReducedMotion();
  const [count, setCount] = useState(instant ? text.length : 0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (instant) {
      setCount(text.length);
      return;
    }
    setCount(0);
    startRef.current = performance.now();
    let frame: number;
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      const next = Math.min(text.length, Math.floor((elapsed / 1000) * speed));
      setCount(next);
      if (next < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, speed, instant]);

  return (
    <span>
      {text.slice(0, count)}
      {count < text.length && <span className="type-caret" aria-hidden />}
    </span>
  );
}
