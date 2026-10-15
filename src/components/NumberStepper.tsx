import { useEffect, useState } from 'react';

export default function NumberStepper({ id, label, value, min, max, onChange }: {
  id: string; label: string; value: number; min: number; max: number; onChange(value: number): void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  function commit(next: number) {
    const bounded = Math.min(max, Math.max(min, Number.isFinite(next) ? Math.round(next) : value));
    setText(String(bounded)); onChange(bounded);
  }
  return <div className="number-field"><label htmlFor={id}>{label}</label><div className="number-stepper">
    <button type="button" aria-label={`减少${label}`} disabled={value <= min} onClick={() => commit(value - 1)}>−</button>
    <input id={id} type="number" inputMode="numeric" min={min} max={max} step="1" required value={text}
      onFocus={event => event.currentTarget.select()}
      onChange={event => { const raw = event.target.value; setText(raw); const next = Number(raw); if (raw !== '' && Number.isInteger(next) && next >= min && next <= max) onChange(next); }}
      onBlur={() => commit(text === '' ? value : Number(text))} />
    <button type="button" aria-label={`增加${label}`} disabled={value >= max} onClick={() => commit(value + 1)}>+</button>
  </div></div>;
}
