import React, { useEffect, useRef, useState } from 'react';
import type {
  CoreConfig, Assumptions, StateCode, RothConversionPlan,
  HomeHolding, HomeEvent,
  EquityCompPlan, EquityVestWindow, EquityExerciseEvent,
} from '../types';
import { ALL_STATE_CODES, STATE_NAMES, STATE_TAX_DATA } from '../engine/stateTaxData';

function makeEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `he-${Math.random().toString(36).slice(2, 10)}`;
}

/** Sensible defaults for a new "buy" event — editable in the UI. */
function defaultBuyEvent(atAge: number): Extract<HomeEvent, { kind: 'buy' }> {
  return {
    id: makeEventId(),
    kind: 'buy',
    atAge,
    purchasePrice: 500_000,
    downPaymentPct: 0.2,
    mortgageRate: 0.065,
    mortgageYears: 30,
    closingCostPct: 0.03,
    propertyTaxRate: 0.012,
    insuranceRate: 0.004,
    maintenanceRate: 0.01,
    hoaAnnual: 0,
    appreciationRate: 0.035,
    primaryResidence: true,
  };
}

function defaultSellEvent(atAge: number): Extract<HomeEvent, { kind: 'sell' }> {
  return { id: makeEventId(), kind: 'sell', atAge, sellingCostPct: 0.07 };
}

function defaultHomeHolding(currentAge: number): HomeHolding {
  return {
    currentValue: 500_000,
    mortgageBalance: 300_000,
    mortgageRate: 0.055,
    mortgageYearsRemaining: 25,
    costBasis: 400_000,
    ownershipStartAge: Math.max(18, currentAge - 3),
    propertyTaxRate: 0.012,
    insuranceRate: 0.004,
    maintenanceRate: 0.01,
    hoaAnnual: 0,
    appreciationRate: 0.035,
    primaryResidence: true,
  };
}

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

interface HomeHoldingEditorProps {
  holding: HomeHolding | null;
  currentAge: number;
  onChange: (h: HomeHolding | null) => void;
}

const HomeHoldingEditor: React.FC<HomeHoldingEditorProps> = ({ holding, currentAge, onChange }) => {
  if (!holding) {
    return (
      <button
        type="button"
        className="roth-conversions__add"
        onClick={() => onChange(defaultHomeHolding(currentAge))}
      >
        + I currently own a home
      </button>
    );
  }
  const patch = (p: Partial<HomeHolding>) => onChange({ ...holding, ...p });
  return (
    <div className="roth-conversions">
      <div className="settings__grid settings__grid--2col">
        <Field label="Market value" value={holding.currentValue} step={10_000} min={0} prefix="$"
          onChange={(v) => patch({ currentValue: v })} />
        <Field label="Mortgage bal" value={holding.mortgageBalance} step={10_000} min={0} prefix="$"
          onChange={(v) => patch({ mortgageBalance: v })} />
        <Field label="Rate %" value={+(holding.mortgageRate * 100).toFixed(3)} step={0.125} min={0}
          onChange={(v) => patch({ mortgageRate: v / 100 })} />
        <Field label="Yrs left" value={holding.mortgageYearsRemaining} step={1} min={0} max={40}
          onChange={(v) => patch({ mortgageYearsRemaining: v })} />
        <Field label="Cost basis" value={holding.costBasis} step={10_000} min={0} prefix="$"
          onChange={(v) => patch({ costBasis: v })} />
        <Field label="Owned since age" value={holding.ownershipStartAge} step={1} min={18} max={100}
          onChange={(v) => patch({ ownershipStartAge: v })} />
        <Field label="Property tax %" value={+(holding.propertyTaxRate * 100).toFixed(3)} step={0.05} min={0}
          onChange={(v) => patch({ propertyTaxRate: v / 100 })} />
        <Field label="Insurance %" value={+(holding.insuranceRate * 100).toFixed(3)} step={0.05} min={0}
          onChange={(v) => patch({ insuranceRate: v / 100 })} />
        <Field label="Maintenance %" value={+(holding.maintenanceRate * 100).toFixed(3)} step={0.1} min={0}
          onChange={(v) => patch({ maintenanceRate: v / 100 })} />
        <Field label="HOA / yr" value={holding.hoaAnnual} step={100} min={0} prefix="$"
          onChange={(v) => patch({ hoaAnnual: v })} />
        <Field label="Appreciation %" value={+(holding.appreciationRate * 100).toFixed(3)} step={0.1} min={-5}
          onChange={(v) => patch({ appreciationRate: v / 100 })} />
      </div>
      <label className="roth-conversions__field">
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <input
            type="checkbox"
            checked={holding.primaryResidence}
            onChange={(e) => patch({ primaryResidence: e.target.checked })}
          />
          Primary residence (unlocks §121 exclusion on sale)
        </span>
      </label>
      <button type="button" className="roth-conversions__remove settings__inline-btn"
        onClick={() => onChange(null)}>
        Remove home
      </button>
    </div>
  );
};

interface HomeEventsEditorProps {
  events: HomeEvent[];
  currentAge: number;
  onChange: (events: HomeEvent[]) => void;
}

const HomeEventsEditor: React.FC<HomeEventsEditorProps> = ({ events, currentAge, onChange }) => {
  const addBuy = () => onChange([...events, defaultBuyEvent(Math.max(currentAge + 1, 35))]);
  const addSell = () => onChange([...events, defaultSellEvent(Math.max(currentAge + 5, 60))]);
  const remove = (id: string) => onChange(events.filter((e) => e.id !== id));
  const update = (id: string, patch: Partial<HomeEvent>) => {
    onChange(events.map((e) => {
      if (e.id !== id) return e;
      // Preserve discriminated union by typing patch against the specific variant.
      return { ...e, ...patch } as HomeEvent;
    }));
  };
  return (
    <div className="roth-conversions">
      {events.map((e) => (
        <div key={e.id} className="roth-conversions" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: '0.4rem' }}>
          <div className="roth-conversions__row">
            <label className="roth-conversions__field">
              <span>Kind</span>
              <select
                value={e.kind}
                onChange={(ev) => {
                  const kind = ev.target.value as 'buy' | 'sell';
                  onChange(events.map((x) => x.id === e.id
                    ? (kind === 'buy' ? defaultBuyEvent(e.atAge) : defaultSellEvent(e.atAge))
                    : x));
                }}
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </label>
            <label className="roth-conversions__field">
              <span>At age</span>
              <input type="number" min={18} max={100} value={e.atAge}
                onChange={(ev) => update(e.id, { atAge: +ev.target.value })} />
            </label>
            <div />
            <button type="button" className="roth-conversions__remove" onClick={() => remove(e.id)}>×</button>
          </div>
          {e.kind === 'buy' ? (
            <div className="settings__grid settings__grid--2col">
              <Field label="Price" value={e.purchasePrice} step={10_000} min={0} prefix="$"
                onChange={(v) => update(e.id, { purchasePrice: v })} />
              <Field label="Down %" value={+(e.downPaymentPct * 100).toFixed(2)} step={1} min={0} max={100}
                onChange={(v) => update(e.id, { downPaymentPct: v / 100 })} />
              <Field label="Rate %" value={+(e.mortgageRate * 100).toFixed(3)} step={0.125} min={0}
                onChange={(v) => update(e.id, { mortgageRate: v / 100 })} />
              <Field label="Term (yrs)" value={e.mortgageYears} step={5} min={1} max={40}
                onChange={(v) => update(e.id, { mortgageYears: v })} />
              <Field label="Closing %" value={+(e.closingCostPct * 100).toFixed(3)} step={0.25} min={0}
                onChange={(v) => update(e.id, { closingCostPct: v / 100 })} />
              <Field label="Property tax %" value={+(e.propertyTaxRate * 100).toFixed(3)} step={0.05} min={0}
                onChange={(v) => update(e.id, { propertyTaxRate: v / 100 })} />
              <Field label="Insurance %" value={+(e.insuranceRate * 100).toFixed(3)} step={0.05} min={0}
                onChange={(v) => update(e.id, { insuranceRate: v / 100 })} />
              <Field label="Maintenance %" value={+(e.maintenanceRate * 100).toFixed(3)} step={0.1} min={0}
                onChange={(v) => update(e.id, { maintenanceRate: v / 100 })} />
              <Field label="HOA / yr" value={e.hoaAnnual} step={100} min={0} prefix="$"
                onChange={(v) => update(e.id, { hoaAnnual: v })} />
              <Field label="Appreciation %" value={+(e.appreciationRate * 100).toFixed(3)} step={0.1} min={-5}
                onChange={(v) => update(e.id, { appreciationRate: v / 100 })} />
              <label className="roth-conversions__field roth-conversions__field--wide">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <input
                    type="checkbox"
                    checked={e.primaryResidence}
                    onChange={(ev) => update(e.id, { primaryResidence: ev.target.checked })}
                  />
                  Primary residence
                </span>
              </label>
            </div>
          ) : (
            <div className="settings__grid settings__grid--2col">
              <Field label="Selling cost %" value={+(e.sellingCostPct * 100).toFixed(3)} step={0.25} min={0}
                onChange={(v) => update(e.id, { sellingCostPct: v / 100 })} />
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <button type="button" className="roth-conversions__add" onClick={addBuy}>+ Buy event</button>
        <button type="button" className="roth-conversions__add" onClick={addSell}>+ Sell event</button>
      </div>
    </div>
  );
};

interface EquityEditorProps {
  plan: EquityCompPlan;
  currentAge: number;
  onChange: (plan: EquityCompPlan) => void;
}

const EquityEditor: React.FC<EquityEditorProps> = ({ plan, currentAge, onChange }) => {
  const addVest = () => onChange({
    ...plan,
    vests: [
      ...plan.vests,
      { fromAge: currentAge, toAge: currentAge + 3, annualGross: 100_000 },
    ],
  });
  const removeVest = (idx: number) => onChange({
    ...plan,
    vests: plan.vests.filter((_, i) => i !== idx),
  });
  const updateVest = (idx: number, patch: Partial<EquityVestWindow>) => onChange({
    ...plan,
    vests: plan.vests.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
  });

  const addExercise = () => onChange({
    ...plan,
    exercises: [
      ...plan.exercises,
      { age: currentAge, type: 'NSO', amount: 100_000 },
    ],
  });
  const removeExercise = (idx: number) => onChange({
    ...plan,
    exercises: plan.exercises.filter((_, i) => i !== idx),
  });
  const updateExercise = (idx: number, patch: Partial<EquityExerciseEvent>) => onChange({
    ...plan,
    exercises: plan.exercises.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
  });

  return (
    <div className="roth-conversions">
      <div className="roth-conversions__subgroup">
        <div className="roth-conversions__subgroup-label">RSU vests (annual, sold at vest)</div>
        {plan.vests.map((v, idx) => (
          <div key={`v-${idx}`} className="roth-conversions__row">
            <label className="roth-conversions__field">
              <span>From</span>
              <input type="number" min={18} max={90} value={v.fromAge}
                onChange={(e) => updateVest(idx, { fromAge: +e.target.value })} />
            </label>
            <label className="roth-conversions__field">
              <span>To</span>
              <input type="number" min={18} max={90} value={v.toAge}
                onChange={(e) => updateVest(idx, { toAge: +e.target.value })} />
            </label>
            <label className="roth-conversions__field roth-conversions__field--wide">
              <span>Annual $</span>
              <input type="number" min={0} step={5000} value={v.annualGross}
                onChange={(e) => updateVest(idx, { annualGross: +e.target.value })} />
            </label>
            <button type="button" className="roth-conversions__remove" onClick={() => removeVest(idx)}>×</button>
          </div>
        ))}
        <button type="button" className="roth-conversions__add" onClick={addVest}>+ RSU vest</button>
      </div>

      <div className="roth-conversions__subgroup">
        <div className="roth-conversions__subgroup-label">Option exercises (one-time)</div>
        {plan.exercises.map((e, idx) => (
          <div key={`x-${idx}`} className="roth-conversions__row equity-editor__row--exercise">
            <label className="roth-conversions__field">
              <span>Age</span>
              <input type="number" min={18} max={90} value={e.age}
                onChange={(ev) => updateExercise(idx, { age: +ev.target.value })} />
            </label>
            <label className="roth-conversions__field">
              <span>Type</span>
              <select value={e.type}
                onChange={(ev) => updateExercise(idx, { type: ev.target.value as EquityExerciseEvent['type'] })}>
                <option value="NSO">NSO</option>
                <option value="ISO">ISO</option>
                <option value="ESPP">ESPP</option>
              </select>
            </label>
            <label className="roth-conversions__field roth-conversions__field--wide">
              <span>Amount $</span>
              <input type="number" min={0} step={5000} value={e.amount}
                onChange={(ev) => updateExercise(idx, { amount: +ev.target.value })} />
            </label>
            <button type="button" className="roth-conversions__remove" onClick={() => removeExercise(idx)}>×</button>
          </div>
        ))}
        <button type="button" className="roth-conversions__add" onClick={addExercise}>+ Exercise</button>
      </div>
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
        <div className="settings__group-label">Early retirement rules</div>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={core.rule55Enabled}
            onChange={(e) => set('rule55Enabled', e.target.checked)}
          />
          <span className="field__label" style={{ margin: 0 }}>
            Rule of 55 (no penalty on 401k at 55+)
          </span>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={core.acaEnabled}
            onChange={(e) => set('acaEnabled', e.target.checked)}
          />
          <span className="field__label" style={{ margin: 0 }}>
            Use ACA in gap ({core.retirementAge}–64)
          </span>
        </label>
        {core.acaEnabled && (
          <div className="settings__grid settings__grid--2col">
            <Field label="Household size" value={core.householdSize} step={1} min={1} max={10}
              onChange={(v) => set('householdSize', v)} />
            <Field label="SLCSP / yr" value={core.acaSLCSPAnnual} step={500} min={0} prefix="$"
              onChange={(v) => set('acaSLCSPAnnual', v)} />
          </div>
        )}
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Equity compensation</div>
        <EquityEditor
          plan={core.equityComp}
          currentAge={core.age}
          onChange={(plan) => set('equityComp', plan)}
        />
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Roth conversions</div>
        <RothConversionEditor
          plans={core.rothConversions}
          onChange={(plans) => set('rothConversions', plans)}
        />
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Current home</div>
        <HomeHoldingEditor
          holding={core.currentHome}
          currentAge={core.age}
          onChange={(h) => set('currentHome', h)}
        />
      </div>

      <div className="settings__group">
        <div className="settings__group-label">Planned home events</div>
        <HomeEventsEditor
          events={core.homeEvents}
          currentAge={core.age}
          onChange={(evs) => set('homeEvents', evs)}
        />
      </div>
    </div>
  );
};
