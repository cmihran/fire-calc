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
      <Slider
        label={`Return rate: ${toPct(sliders.expectedReturn)}%`}
        min={0} max={0.12} step={0.005}
        value={sliders.expectedReturn}
        onChange={(v) => update('expectedReturn', v)}
        accent="cyan"
      />
      <Slider
        label={`Comp growth: ${toPct(sliders.incomeGrowthRate)}%`}
        min={0} max={0.2} step={0.005}
        value={sliders.incomeGrowthRate}
        onChange={(v) => update('incomeGrowthRate', v)}
        accent="purple"
      />
      <Slider
        label={`Spending growth: ${toPct(sliders.spendingGrowth)}%`}
        min={0} max={0.08} step={0.0025}
        value={sliders.spendingGrowth}
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
  <div>
    <label className="slider__label">{label.toUpperCase()}</label>
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

function toPct(v: number): string {
  return (v * 100).toFixed(1);
}
