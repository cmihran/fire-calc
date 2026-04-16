import React from 'react';
import type { Tick } from '../types';
import { fmt } from '../utils/format';

interface Props {
  ticks: Tick[];
  milestoneAges: number[];
}

export const YearTable: React.FC<Props> = ({ ticks, milestoneAges }) => (
  <div className="card year-table-card">
    <h2 className="year-table-card__heading">Year by year</h2>
    <div className="year-table-wrap">
      <table className="year-table">
        <thead>
          <tr>
            <th>Age</th>
            <th>Comp</th>
            <th>Tax %</th>
            <th>Spend</th>
            <th>Net worth</th>
            <th>Trad</th>
            <th>Roth</th>
            <th>Taxable</th>
          </tr>
        </thead>
        <tbody>
          {ticks.map((t) => {
            const isMilestone = milestoneAges.includes(t.age);
            return (
              <tr key={t.age} className={isMilestone ? 'milestone' : ''}>
                <td className="age-cell">{t.age}</td>
                <td className="muted-soft">{fmt(t.comp)}</td>
                <td className="muted-heavy">{t.taxRate != null ? `${t.taxRate}%` : '—'}</td>
                <td className="muted-heavy">{fmt(t.spending)}</td>
                <td className="networth-cell">{fmt(t.netWorth)}</td>
                <td className="muted">{fmt(t.traditional)}</td>
                <td className="muted">{fmt(t.roth)}</td>
                <td className="muted">{fmt(t.taxable)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);
