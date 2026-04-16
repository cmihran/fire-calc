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
        <div className="settings__grid">
          <Field label="Age" value={core.age} step={1} min={18} max={90}
            onChange={(v) => set('age', v)} />
          <Field label="Retire" value={core.retirementAge} step={1} min={30} max={90}
            onChange={(v) => set('retirementAge', v)} />
          <Field label="End" value={core.endAge} step={5} min={50} max={120}
            onChange={(v) => set('endAge', v)} />
        </div>
        <div className="settings__grid settings__grid--2col">
          <Field label="Gross comp" value={core.annualIncome} step={1000} min={0} prefix="$"
            onChange={(v) => set('annualIncome', v)} />
          <Field label="Monthly spend" value={core.monthlySpending} step={100} min={0} prefix="$"
            onChange={(v) => set('monthlySpending', v)} />
        </div>
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Balances</div>
        <div className="settings__grid settings__grid--2col">
          <Field label="After-tax" value={core.afterTax} step={1000} min={0} prefix="$"
            onChange={(v) => set('afterTax', v)} />
          <Field label="Traditional" value={core.traditional} step={1000} min={0} prefix="$"
            onChange={(v) => set('traditional', v)} />
          <Field label="Roth + HSA" value={core.roth} step={1000} min={0} prefix="$"
            onChange={(v) => set('roth', v)} />
          <Field label="Home equity" value={core.homeEquity} step={1000} min={0} prefix="$"
            onChange={(v) => set('homeEquity', v)} />
          <Field label="Other debt" value={core.otherDebt} step={1000} min={0} prefix="$"
            onChange={(v) => set('otherDebt', v)} />
        </div>
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Contributions</div>
        <ContribSlider
          label="Pre-tax 401k"
          pct={core.pretax401kPct}
          limit={23_500}
          onChange={(v) => set('pretax401kPct', v)}
        />
        <ContribSlider
          label="Mega backdoor"
          pct={core.megaBackdoorPct}
          limit={46_500}
          onChange={(v) => set('megaBackdoorPct', v)}
        />
      </div>
    </div>
  );
};

interface ContribSliderProps {
  label: string;
  pct: number;
  limit: number;
  onChange: (pct: number) => void;
}

const ContribSlider: React.FC<ContribSliderProps> = ({ label, pct, limit, onChange }) => {
  const dollars = Math.round(pct * limit);
  return (
    <div className="contrib-slider">
      <div className="contrib-slider__head">
        <span className="contrib-slider__label">{label}</span>
        <span className="contrib-slider__value">
          {Math.round(pct * 100)}% · ${dollars.toLocaleString()}
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
      />
    </div>
  );
};

interface FieldProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  prefix?: string;
  onChange: (v: number) => void;
}

const Field: React.FC<FieldProps> = ({ label, value, step, min, max, prefix, onChange }) => {
  const [text, setText] = useState<string>(String(value));
  const lastCommitted = useRef<number>(value);

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
    <label className="field">
      <span className="field__label">{label}</span>
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
