import React, { useEffect, useRef, useState } from 'react';
import type { CoreConfig } from '../types';

interface Props {
  core: CoreConfig;
  onChange: (next: CoreConfig) => void;
}

export const Settings: React.FC<Props> = ({ core, onChange }) => {
  const set = <K extends keyof CoreConfig>(key: K, value: CoreConfig[K]) => {
    onChange({ ...core, [key]: value });
  };

  return (
    <div className="settings">
      <div className="settings__group">
        <div className="settings__group-label">You</div>
        <div className="settings__row">
          <Field label="Age" value={core.age} step={1} min={18} max={90}
            onChange={(v) => set('age', v)} />
          <Field label="Retire age" value={core.retirementAge} step={1} min={30} max={90}
            onChange={(v) => set('retirementAge', v)} />
          <Field label="End age" value={core.endAge} step={5} min={50} max={120}
            onChange={(v) => set('endAge', v)} />
          <Field label="Annual gross comp" hint="offer letter #, includes 401k"
            value={core.annualIncome} step={1000} min={0} prefix="$"
            onChange={(v) => set('annualIncome', v)} wide />
          <Field label="Monthly spend" hint="non-mortgage"
            value={core.monthlySpending} step={100} min={0} prefix="$"
            onChange={(v) => set('monthlySpending', v)} wide />
        </div>
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Balances</div>
        <div className="settings__row">
          <Field label="After-tax" value={core.afterTax} step={1000} min={0} prefix="$"
            onChange={(v) => set('afterTax', v)} wide />
          <Field label="Traditional" value={core.traditional} step={1000} min={0} prefix="$"
            onChange={(v) => set('traditional', v)} wide />
          <Field label="Roth + HSA" value={core.roth} step={1000} min={0} prefix="$"
            onChange={(v) => set('roth', v)} wide />
          <Field label="Home equity" value={core.homeEquity} step={1000} min={0} prefix="$"
            onChange={(v) => set('homeEquity', v)} wide />
          <Field label="Other debt" value={core.otherDebt} step={1000} min={0} prefix="$"
            onChange={(v) => set('otherDebt', v)} wide />
        </div>
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Contributions</div>
        <div className="settings__row" style={{ flexDirection: 'column', gap: 6 }}>
          <ContribSlider
            label="Pre-tax 401k"
            hint="deducted from gross comp"
            pct={core.pretax401kPct}
            limit={23_500}
            onChange={(v) => set('pretax401kPct', v)}
          />
          <ContribSlider
            label="Mega backdoor"
            hint="deducted from take-home"
            pct={core.megaBackdoorPct}
            limit={46_500}
            onChange={(v) => set('megaBackdoorPct', v)}
          />
        </div>
      </div>
    </div>
  );
};

interface ContribSliderProps {
  label: string;
  hint: string;
  pct: number;
  limit: number;
  onChange: (pct: number) => void;
}

const ContribSlider: React.FC<ContribSliderProps> = ({ label, hint, pct, limit, onChange }) => {
  const dollars = Math.round(pct * limit);
  return (
    <div className="contrib-slider">
      <div className="contrib-slider__head">
        <span className="field__label">
          {label.toUpperCase()}
          <span className="field__hint"> — {hint}</span>
        </span>
        <span className="contrib-slider__value">
          {Math.round(pct * 100)}% (${dollars.toLocaleString()}/yr)
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={pct}
        onChange={(e) => onChange(+e.target.value)}
        className="slider__input slider__input--green"
        style={{ width: '100%' }}
      />
    </div>
  );
};

interface FieldProps {
  label: string;
  hint?: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  prefix?: string;
  wide?: boolean;
  onChange: (v: number) => void;
}

const Field: React.FC<FieldProps> = ({ label, hint, value, step, min, max, prefix, wide, onChange }) => {
  // Local text buffer so the input can be empty mid-edit without the parent
  // snapping it back to "0". We only push a numeric value upstream on valid
  // parse; on blur with an empty/invalid string we revert to the committed value.
  const [text, setText] = useState<string>(String(value));
  const lastCommitted = useRef<number>(value);

  // Re-sync when the external value changes for reasons other than our own commit
  // (e.g., reset button, external config reload).
  useEffect(() => {
    if (value !== lastCommitted.current) {
      setText(String(value));
      lastCommitted.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    if (raw === '' || raw === '-') return;
    const n = +raw;
    if (!Number.isNaN(n)) {
      lastCommitted.current = n;
      onChange(n);
    }
  };

  const handleBlur = () => {
    if (text === '' || Number.isNaN(+text)) {
      setText(String(value));
    }
  };

  return (
    <label className={`field ${wide ? 'field--wide' : ''}`}>
      <span className="field__label">
        {label}
        {hint && <span className="field__hint"> — {hint}</span>}
      </span>
      <span className="field__control">
        {prefix && <span className="field__prefix">{prefix}</span>}
        <input
          type="number"
          className="field__input"
          value={text}
          step={step}
          min={min}
          max={max}
          onChange={handleChange}
          onBlur={handleBlur}
        />
      </span>
    </label>
  );
};
