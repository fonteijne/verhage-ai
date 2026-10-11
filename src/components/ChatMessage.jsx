import { useRef, useState } from 'react';
import ProductCard from './ProductCard.jsx';
import { euro } from '../lib/api.js';
import { parseBlocks } from '../lib/richtext.js';
import { gsap, useGSAP, SplitText, reducedMotion } from '../lib/motion.js';

const KIND_LABEL = {
  completion: 'maakt het compleet',
  upgrade: 'upgrade',
  suggestion: 'aanrader',
};

export default function ChatMessage({ message, onSend, disabled }) {
  const [showTrace, setShowTrace] = useState(false);
  const { role, text, products = [], suggestions = [], events = [] } = message;
  const root = useRef(null);

  // Entrance: bubble pops from its corner, an assistant reply reveals word by
  // word, then product cards and suggestions follow. Messages never change
  // after mount, so this runs once.
  useGSAP(
    () => {
      if (reducedMotion()) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out', clearProps: 'transform,opacity' } });
      tl.from('.bubble', {
        opacity: 0, y: 18, scale: 0.94, duration: 0.5,
        transformOrigin: role === 'user' ? '100% 100%' : '0% 100%',
      });

      const blocks = role === 'assistant' ? gsap.utils.toArray('.bubble p, .bubble li') : [];
      if (blocks.length && text.length < 500) {
        const split = new SplitText(blocks, { type: 'words' });
        tl.from(split.words, { opacity: 0, y: 7, duration: 0.35, stagger: 0.022 }, 0.12);
        tl.add(() => split.revert()); // hand the plain text back to React
      }

      if (products.length || suggestions.length) {
        tl.from('.product-card', { opacity: 0, y: 26, scale: 0.92, duration: 0.55, stagger: 0.08, ease: 'back.out(1.6)' }, '>-0.15');
        tl.from('.suggestions', { opacity: 0, y: 14, duration: 0.45 }, '<0.1');
        tl.from('.suggestion', { opacity: 0, x: -14, duration: 0.4, stagger: 0.1 }, '<0.15');
      }
    },
    { scope: root }
  );

  return (
    <div className={`msg ${role}`} ref={root}>
      <div className="bubble">
        <RichText text={text} />
      </div>

      {products.length > 0 && (
        <div className="cards">
          {products.slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} onSend={onSend} disabled={disabled} />
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="suggestions">
          <p className="suggestions-title">Past hier goed bij</p>
          {suggestions.map((s) => (
            <div key={s.id} className="suggestion">
              <div>
                <span className={`kind ${s.kind}`}>{KIND_LABEL[s.kind] || s.kind}</span>
                <strong>{s.name}</strong> <span className="price">{euro(s.price)}</span>
                <p className="reason">{s.reason}</p>
              </div>
              <div className="suggestion-actions">
                <button disabled={disabled} onClick={() => onSend(`Ja, doe maar een ${s.name}`)}>
                  Ja, graag
                </button>
                <button
                  className="ghost"
                  disabled={disabled}
                  onClick={() => onSend(`Nee, geen ${s.name}`)}
                >
                  Nee
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="trace">
          <button className="trace-toggle" onClick={() => setShowTrace((v) => !v)}>
            {showTrace ? 'Verberg' : 'Toon'} wat de agent deed ({events.length})
          </button>
          {showTrace && (
            <ul>
              {events.map((e, i) => (
                <li key={i}>
                  <code>{e.tool}</code>
                  <span className="trace-args">{summarizeInput(e.input)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders the light markdown models emit, as elements rather than raw HTML. */
function Inline({ parts }) {
  return parts.map((part, i) => {
    if (part.type === 'bold') return <strong key={i}>{part.value}</strong>;
    if (part.type === 'italic') return <em key={i}>{part.value}</em>;
    return <span key={i}>{part.value}</span>;
  });
}

function RichText({ text }) {
  return parseBlocks(text).map((block, i) => {
    if (block.type === 'list') {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List key={i}>
          {block.items.map((item, j) => (
            <li key={j}><Inline parts={item} /></li>
          ))}
        </List>
      );
    }
    if (block.type === 'heading') {
      return <p key={i} className="bubble-heading"><Inline parts={block.parts} /></p>;
    }
    return <p key={i}><Inline parts={block.parts} /></p>;
  });
}

function summarizeInput(input) {
  if (!input || !Object.keys(input).length) return '';
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`)
    .join(' · ');
}
