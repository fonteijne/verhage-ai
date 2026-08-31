import { useState } from 'react';
import ProductCard from './ProductCard.jsx';
import { euro } from '../lib/api.js';
import { parseBlocks } from '../lib/richtext.js';

const KIND_LABEL = {
  completion: 'maakt het compleet',
  upgrade: 'upgrade',
  suggestion: 'aanrader',
};

export default function ChatMessage({ message, onSend, disabled }) {
  const [showTrace, setShowTrace] = useState(false);
  const { role, text, products = [], suggestions = [], events = [] } = message;

  return (
    <div className={`msg ${role}`}>
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
