const json = async (url, options) => {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.reply) throw new Error(body.message || body.error || `Request failed (${res.status})`);
  return body;
};

export const startSession = () => json('/api/session', { method: 'POST' });

export const sendMessage = (sessionId, message) =>
  json('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });

export const euro = (n) => `€${Number(n).toFixed(2).replace('.', ',')}`;
