import React from 'react';
import type { SliderOverrides } from '../types';

interface Props {
  sliders: SliderOverrides;
  onChange: (next: SliderOverrides) => void;
}

export const Controls: React.FC<Props> = ({ sliders, onChange }) => {
  const update = <K extends keyof SliderOverrides>(key: K, value: number) => {
    onChange({ ...sliders, [key]: value });
  };

  return (
    <div className="controls">
      <div className="settings__group-label">Rates</div>
      <Slider
        label="Return"
        value={sliders.expectedReturn}
        min={0} max={0.12} step={0.005}
        onChange={(v) => update('expectedReturn', v)}
        accent="cyan"
      />
      <Slider
        label="Comp growth"
        value={sliders.incomeGrowthRate}
        min={0} max={0.2} step={0.005}
        onChange={(v) => update('incomeGrowthRate', v)}
        accent="purple"
      />
      <Slider
        label="Spend growth"
        value={sliders.spendingGrowth}
        min={0} max={0.08} step={0.0025}
        onChange={(v) => update('spendingGrowth', v)}
        accent="green"
      />
    </div>
  );
};

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  accent?: 'cyan' | 'purple' | 'green';
}

const Slider: React.FC<SliderProps> = ({ label, min, max, step, value, onChange, accent = 'cyan' }) => (
  <div className="rate-slider">
    <div className="rate-slider__head">
      <span className="rate-slider__label">{label}</span>
      <span className={`rate-slider__value rate-slider__value--${accent}`}>
        {(value * 100).toFixed(1)}%
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(+e.target.value)}
      className={`slider__input slider__input--${accent}`}
    />
  </div>
);
