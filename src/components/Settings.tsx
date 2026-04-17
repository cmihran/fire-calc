import React, { useEffect, useRef, useState } from 'react';
import type { CoreConfig, Assumptions, StateCode, RothConversionPlan } from '../types';
import { ALL_STATE_CODES, STATE_NAMES, STATE_TAX_DATA } from '../engine/stateTaxData';

const ROTH_PHASEOUT = {
  single: { floor: 150_000, ceiling: 165_000 },
  married_filing_jointly: { floor: 236_000, ceiling: 246_000 },
} as const;

function rothIRAEligibleDollars(
  income: number, pretax401kPct: number, hsaContribPct: number,
  desiredPct: number, filingStatus: 'single' | 'married_filing_jointly',
): number {
  const magi = income - pretax401kPct * 23_500 - hsaContribPct * 8_550;
  const desired = Math.round(desiredPct * 7_000);
  const { floor, ceiling } = ROTH_PHASEOUT[filingStatus];
  if (magi <= floor) return desired;
  if (magi >= ceiling) return 0;
  const ratio = 1 - (magi - floor) / (ceiling - floor);
  return Math.round(desired * ratio);
}

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

interface RothIRASliderProps {
  pct: number;
  eligible: number;
  onChange: (pct: number) => void;
}

const RothIRASlider: React.FC<RothIRASliderProps> = ({ pct, eligible, onChange }) => {
  const desired = Math.round(pct * 7_000);
  const reduced = eligible < desired;
  return (
    <div className={`contrib-slider${eligible === 0 && pct > 0 ? ' contrib-slider--dimmed' : ''}`}>
      <div className="contrib-slider__head">
        <span className="contrib-slider__label">Roth IRA</span>
        <span className="contrib-slider__value">
          {Math.round(pct * 100)}% · ${desired.toLocaleString()}
        </span>
      </div>
      {reduced && (
        <div className="contrib-slider__status">
          <span className="contrib-slider__phaseout">{eligible === 0 ? 'Over income limit' : 'Phased out'}</span>
          <span className="contrib-slider__eligible"> → ${eligible.toLocaleString()} eligible</span>
        </div>
      )}
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

interface RothConversionEditorProps {
  plans: RothConversionPlan[];
  onChange: (plans: RothConversionPlan[]) => void;
}

const RothConversionEditor: React.FC<RothConversionEditorProps> = ({ plans, onChange }) => {
  const add = () => onChange([...plans, { fromAge: 55, toAge: 65, targetBracketTop: 100_525 }]);
  const remove = (idx: number) => onChange(plans.filter((_, i) => i !== idx));
  const update = (idx: number, patch: Partial<RothConversionPlan>) => {
    onChange(plans.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  return (
    <div className="roth-conversions">
      {plans.map((p, idx) => (
        <div key={idx} className="roth-conversions__row">
          <label className="roth-conversions__field">
            <span>From</span>
            <input type="number" min={40} max={100} value={p.fromAge}
              onChange={(e) => update(idx, { fromAge: +e.target.value })} />
          </label>
          <label className="roth-conversions__field">
            <span>To</span>
            <input type="number" min={40} max={100} value={p.toAge}
              onChange={(e) => update(idx, { toAge: +e.target.value })} />
          </label>
          <label className="roth-conversions__field roth-conversions__field--wide">
            <span>Fill to $</span>
            <input type="number" min={0} step={5000} value={p.targetBracketTop}
              onChange={(e) => update(idx, { targetBracketTop: +e.target.value })} />
          </label>
          <button type="button" className="roth-conversions__remove" onClick={() => remove(idx)}>×</button>
        </div>
      ))}
      <button type="button" className="roth-conversions__add" onClick={add}>+ Conversion window</button>
    </div>
  );
};

interface Props {
  core: CoreConfig;
  assumptions: Assumptions;
  onChange: (next: CoreConfig) => void;
}

export const Settings: React.FC<Props> = ({ core, assumptions, onChange }) => {
  const set = <K extends keyof CoreConfig>(key: K, value: CoreConfig[K]) => {
    onChange({ ...core, [key]: value });
  };

  const stateInfo = STATE_TAX_DATA[core.stateOfResidence];
  const cityOptions = stateInfo?.localBrackets ? Object.keys(stateInfo.localBrackets) : [];
  const hasCities = cityOptions.length > 0;

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
        <label className="field">
          <span className="field__label">State</span>
          <select
            className="field__select"
            value={core.stateOfResidence}
            onChange={(e) => {
              const nextState = e.target.value as StateCode;
              const nextCities = STATE_TAX_DATA[nextState]?.localBrackets;
              const nextCity = nextCities ? Object.keys(nextCities)[0] : null;
              onChange({ ...core, stateOfResidence: nextState, cityOfResidence: nextCity });
            }}
          >
            {ALL_STATE_CODES.map((code) => (
              <option key={code} value={code}>
                {code} — {STATE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        {hasCities && (
          <label className="field">
            <span className="field__label">City</span>
            <select
              className="field__select"
              value={core.cityOfResidence ?? ''}
              onChange={(e) => set('cityOfResidence', e.target.value === '' ? null : e.target.value)}
            >
              <option value="">None / elsewhere</option>
              {cityOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Balances</div>
        <div className="settings__grid settings__grid--2col">
          <Field label="After-tax" value={core.afterTax} step={1000} min={0} prefix="$"
            onChange={(v) => set('afterTax', v)} />
          <Field label="…basis" value={core.afterTaxBasis} step={1000} min={0} prefix="$"
            onChange={(v) => set('afterTaxBasis', v)} />
          <Field label="Traditional" value={core.traditional} step={1000} min={0} prefix="$"
            onChange={(v) => set('traditional', v)} />
          <Field label="Roth" value={core.roth} step={1000} min={0} prefix="$"
            onChange={(v) => set('roth', v)} />
          <Field label="HSA" value={core.hsa} step={500} min={0} prefix="$"
            onChange={(v) => set('hsa', v)} />
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
        <RothIRASlider
          pct={core.rothIRAPct}
          eligible={rothIRAEligibleDollars(
            core.annualIncome, core.pretax401kPct, core.hsaContribPct,
            core.rothIRAPct, assumptions.filingStatus,
          )}
          onChange={(v) => set('rothIRAPct', v)}
        />
        <ContribSlider
          label="Mega backdoor"
          pct={core.megaBackdoorPct}
          limit={46_500}
          onChange={(v) => set('megaBackdoorPct', v)}
        />
        <ContribSlider
          label="HSA"
          pct={core.hsaContribPct}
          limit={8_550}
          onChange={(v) => set('hsaContribPct', v)}
        />
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Social Security</div>
        {core.socialSecurity ? (
          <>
            <div className="settings__grid settings__grid--2col">
              <Field label="Claim age" value={core.socialSecurity.claimAge} step={1} min={62} max={70}
                onChange={(v) => set('socialSecurity', { ...core.socialSecurity!, claimAge: v })} />
              <Field label="PIA / mo" value={core.socialSecurity.estimatedPIA} step={50} min={0} prefix="$"
                onChange={(v) => set('socialSecurity', { ...core.socialSecurity!, estimatedPIA: v })} />
            </div>
            <button type="button" className="roth-conversions__remove settings__inline-btn"
              onClick={() => set('socialSecurity', null)}>
              Disable SS
            </button>
          </>
        ) : (
          <button type="button" className="roth-conversions__add"
            onClick={() => set('socialSecurity', { claimAge: 67, estimatedPIA: 2_800 })}>
            + Enable Social Security
          </button>
        )}
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Roth conversions</div>
        <RothConversionEditor
          plans={core.rothConversions}
          onChange={(plans) => set('rothConversions', plans)}
        />
      </div>
    </div>
  );
};
