import React, { useCallback, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import type { Tick } from '../types';
import { fmt, fmtAxis } from '../utils/format';

interface Props {
  data: Tick[];
  milestoneAges: number[];
  retirementAge: number;
  onRetirementAgeChange?: (age: number) => void;
}

export const Chart: React.FC<Props> = ({ data, milestoneAges, retirementAge, onRetirementAgeChange }) => {
  const dragging = useRef(false);
  const [nearLine, setNearLine] = useState(false);

  const handleMouseDown = useCallback((e: { activeLabel?: unknown }) => {
    if (e?.activeLabel != null && onRetirementAgeChange) {
      const label = Number(e.activeLabel);
      if (Math.abs(label - retirementAge) <= 1) {
        dragging.current = true;
      }
    }
  }, [retirementAge, onRetirementAgeChange]);

  const handleMouseMove = useCallback((e: { activeLabel?: unknown }) => {
    if (!e?.activeLabel) { setNearLine(false); return; }
    const label = Number(e.activeLabel);
    setNearLine(Math.abs(label - retirementAge) <= 1);
    if (dragging.current && onRetirementAgeChange) {
      const age = Math.round(label);
      const startAge = data[0]?.age ?? 20;
      const endAge = data[data.length - 1]?.age ?? 90;
      if (age > startAge + 1 && age < endAge - 1) {
        onRetirementAgeChange(age);
      }
    }
  }, [retirementAge, data, onRetirementAgeChange]);

  const handleMouseUp = useCallback(() => { dragging.current = false; }, []);

  return (
  <div
    className={`card chart-card ${nearLine || dragging.current ? 'chart-card--grab' : ''}`}
    onMouseLeave={handleMouseUp}
  >
    <ResponsiveContainer width="100%" height={480}>
      <AreaChart
        data={data}
        margin={{ top: 10, right: 20, left: 10, bottom: 0 }}
        onMouseDown={handleMouseDown as (e: unknown) => void}
        onMouseMove={handleMouseMove as (e: unknown) => void}
        onMouseUp={handleMouseUp}
      >
        <defs>
          <linearGradient id="gTaxable" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f093fb" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#f093fb" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gRoth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#48c774" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#48c774" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gTraditional" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6dd5ed" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#6dd5ed" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gHome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7c77d" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#f7c77d" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="age"
          tick={{ fill: '#666', fontSize: 11 }}
          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
        />
        <YAxis
          tickFormatter={(v) => fmtAxis(v as number)}
          tick={{ fill: '#666', fontSize: 11 }}
          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
          width={65}
        />
        <Tooltip content={<ChartTooltip />} />

        {milestoneAges.map((a) => (
          <ReferenceLine key={a} x={a} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
        ))}

        {/* Glow behind retirement line on hover */}
        {(nearLine || dragging.current) && (
          <ReferenceLine
            x={retirementAge}
            stroke="#f7c77d"
            strokeWidth={12}
            strokeOpacity={0.12}
          />
        )}

        <ReferenceLine
          x={retirementAge}
          stroke={nearLine || dragging.current ? '#ffd700' : '#f7c77d'}
          strokeDasharray={nearLine || dragging.current ? undefined : '4 2'}
          strokeWidth={nearLine || dragging.current ? 2.5 : 1.5}
          label={{
            value: nearLine || dragging.current ? `↔ ${retirementAge}` : `Retire @ ${retirementAge}`,
            position: 'insideTopRight',
            fill: nearLine || dragging.current ? '#ffd700' : '#f7c77d',
            fontSize: 11,
            fontWeight: 600,
          }}
        />

        <Area type="monotone" dataKey="taxable"     stackId="1" stroke="#f093fb" fill="url(#gTaxable)"     strokeWidth={1.5} />
        <Area type="monotone" dataKey="roth"        stackId="1" stroke="#48c774" fill="url(#gRoth)"        strokeWidth={1.5} />
        <Area type="monotone" dataKey="traditional" stackId="1" stroke="#6dd5ed" fill="url(#gTraditional)" strokeWidth={1.5} />
        <Area type="monotone" dataKey="homeEquity"  stackId="1" stroke="#f7c77d" fill="url(#gHome)"        strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>

    <div className="chart-card__legend">
      <span><span className="chart-card__legend-dot" style={{ background: '#f093fb' }} />Taxable</span>
      <span><span className="chart-card__legend-dot" style={{ background: '#48c774' }} />Roth + HSA</span>
      <span><span className="chart-card__legend-dot" style={{ background: '#6dd5ed' }} />Traditional</span>
      <span><span className="chart-card__legend-dot" style={{ background: '#f7c77d' }} />Home</span>
    </div>
  </div>
  );
};

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Tick }>;
}

const ChartTooltip: React.FC<TooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__head">Age {d.age}</div>
      <div className="chart-tooltip__row chart-tooltip__row--strong">
        <span className="chart-tooltip__label-purple">Net Worth</span>
        <span>{fmt(d.netWorth)}</span>
      </div>
      <div className="chart-tooltip__row">
        <span className="chart-tooltip__label-cyan">Traditional</span><span>{fmt(d.traditional)}</span>
      </div>
      <div className="chart-tooltip__row">
        <span className="chart-tooltip__label-green">Roth + HSA</span><span>{fmt(d.roth)}</span>
      </div>
      <div className="chart-tooltip__row">
        <span className="chart-tooltip__label-pink">Taxable</span><span>{fmt(d.taxable)}</span>
      </div>
      {d.homeEquity > 0 && (
        <div className="chart-tooltip__row">
          <span className="chart-tooltip__label-muted">Home equity</span><span>{fmt(d.homeEquity)}</span>
        </div>
      )}

      {d.comp != null && (
        <div className="chart-tooltip__section">
          <div className="chart-tooltip__row">
            <span className="chart-tooltip__label-muted">Comp</span><span>{fmt(d.comp)}</span>
          </div>
          <div className="chart-tooltip__row">
            <span className="chart-tooltip__label-muted">Spending</span><span>{fmt(d.spending)}</span>
          </div>
          {d.comp > 0 && (
            <div className="chart-tooltip__row">
              <span className="chart-tooltip__label-muted">Eff. tax rate</span><span>{d.taxRate}%</span>
            </div>
          )}
          {d.withdrawalTax != null && d.withdrawalTax > 0 && (
            <div className="chart-tooltip__row">
              <span className="chart-tooltip__label-muted">Withdrawal tax</span><span>{fmt(d.withdrawalTax)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
