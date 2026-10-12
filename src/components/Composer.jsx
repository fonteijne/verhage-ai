import { useEffect, useRef, useState } from 'react';

export default function Composer({ onSend, disabled }) {
  const [value, setValue] = useState('');
  const input = useRef(null);

  // The input is disabled while the agent answers, which drops focus; hand it
  // back so the next message can be typed straight away.
  useEffect(() => {
    if (!disabled) input.current?.focus({ preventScroll: true });
  }, [disabled]);

  const submit = (e) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue('');
  };

  return (
    <form className="composer" onSubmit={submit}>
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Waar heb je zin in?"
        aria-label="Bericht"
        disabled={disabled}
        autoComplete="off"
        enterKeyHint="send"
      />
      <button type="submit" disabled={disabled || !value.trim()}>Stuur</button>
    </form>
  );
}
