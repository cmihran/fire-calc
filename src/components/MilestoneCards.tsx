import React, { useState } from 'react';
import type { Tick } from '../types';
import { fmt } from '../utils/format';

interface Props {
  ticks: Tick[];
  milestoneAges: number[];
}

export const MilestoneCards: React.FC<Props> = ({ ticks, milestoneAges }) => {
  const milestones = ticks.filter((t) => milestoneAges.includes(t.age));
  const [expanded, setExpanded] = useState<number | null>(null);

  if (milestones.length === 0) return null;

  return (
    <div className="milestones">
      <div className="milestone-strip">
        {milestones.map((m) => (
          <button
            key={m.age}
            type="button"
            className={`milestone-pill ${expanded === m.age ? 'milestone-pill--active' : ''}`}
            onClick={() => setExpanded(expanded === m.age ? null : m.age)}
          >
            <span className="milestone-pill__age">{m.age}</span>
            <span className="milestone-pill__value">{fmt(m.netWorth)}</span>
          </button>
        ))}
      </div>

      {expanded != null && (() => {
        const m = milestones.find((t) => t.age === expanded);
        if (!m) return null;
        return (
          <div className="milestone-detail">
            <Row label="Traditional" value={fmt(m.traditional)} />
            <Row label="Roth" value={fmt(m.roth)} />
            {m.hsa > 0 && <Row label="HSA" value={fmt(m.hsa)} />}
            <Row label="Taxable" value={fmt(m.taxable)} />
            {m.homeEquity > 0 && <Row label="Home equity" value={fmt(m.homeEquity)} />}
            {m.homeValue > 0 && <Row label="Home value" value={fmt(m.homeValue)} />}
            {m.mortgageBalance > 0 && <Row label="Mortgage bal" value={fmt(-m.mortgageBalance)} />}
            <div className="milestone-detail__divider" />
            <Row label="Comp" value={fmt(m.comp)} />
            {m.socialSecurity != null && m.socialSecurity > 0 && (
              <Row label="Social Security" value={fmt(m.socialSecurity)} />
            )}
            {m.rmd != null && m.rmd > 0 && <Row label="RMD" value={fmt(m.rmd)} />}
            {m.rothConversion != null && m.rothConversion > 0 && (
              <Row label="Roth conversion" value={fmt(m.rothConversion)} />
            )}
            {m.mortgagePayment != null && m.mortgagePayment > 0 && (
              <Row label="Mortgage P&I" value={fmt(m.mortgagePayment)} />
            )}
            {m.mortgageInterest != null && m.mortgageInterest > 0 && (
              <Row label="…interest paid" value={fmt(m.mortgageInterest)} />
            )}
            {m.propertyTax != null && m.propertyTax > 0 && (
              <Row label="Property tax" value={fmt(m.propertyTax)} />
            )}
            {m.homeEventLabel && <Row label="Home event" value={m.homeEventLabel} />}
            {m.homeSaleGain != null && m.homeSaleGain > 0 && (
              <Row label="Home sale gain" value={fmt(m.homeSaleGain)} />
            )}
          </div>
        );
      })()}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="milestone-detail__row">
    <span>{label}</span>
    <span>{value}</span>
  </div>
);
