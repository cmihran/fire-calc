import React from 'react';
import type { Tick } from '../types';
import { fmt } from '../utils/format';

interface Props {
  ticks: Tick[];
  milestoneAges: number[];
}

export const MilestoneCards: React.FC<Props> = ({ ticks, milestoneAges }) => {
  const milestones = ticks.filter((t) => milestoneAges.includes(t.age));
  if (milestones.length === 0) return null;

  return (
    <div className="milestones">
      <h2 className="section-heading">Milestones</h2>
      <div className="milestone-grid">
        {milestones.map((m) => (
          <div key={m.age} className="card--subtle milestone-card">
            <div className="milestone-card__head">
              <span className="milestone-card__age">Age {m.age}</span>
              <span className="milestone-card__total">{fmt(m.netWorth)}</span>
            </div>
            <div className="milestone-card__rows">
              <Row label="Traditional" value={fmt(m.traditional)} />
              <Row label="Roth + HSA" value={fmt(m.roth)} />
              <Row label="Taxable" value={fmt(m.taxable)} />
              {m.homeEquity > 0 && <Row label="Home equity" value={fmt(m.homeEquity)} />}
              <div className="milestone-card__divider">
                <Row label="Comp" value={fmt(m.comp)} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="milestone-card__row">
    <span>{label}</span>
    <span>{value}</span>
  </div>
);
