import React, { useEffect, useRef, useState } from 'react';
import type { Scenario } from '../types';
import { SCENARIO_COLORS } from '../config/quickConfig';

interface Props {
  scenarios: Scenario[];
  activeId: string;
  compareIds: string[];
  readOnly?: boolean;
  onActivate: (id: string) => void;
  onToggleCompare: (id: string) => void;
  onAdd: (name?: string) => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string) => void;
}

export const ScenarioPicker: React.FC<Props> = ({
  scenarios,
  activeId,
  compareIds,
  readOnly = false,
  onActivate,
  onToggleCompare,
  onAdd,
  onDuplicate,
  onDelete,
  onRename,
  onColorChange,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);

  return (
    <div className="scenarios">
      <div className="scenarios__group-label">Scenarios</div>
      <ul className="scenarios__list">
        {scenarios.map((s) => {
          const isActive = s.id === activeId;
          const inCompare = compareIds.includes(s.id);
          return (
            <li
              key={s.id}
              className={`scenario-row ${isActive ? 'scenario-row--active' : ''}`}
            >
              <button
                type="button"
                className="scenario-row__swatch"
                style={{ background: s.color }}
                aria-label={`Change color for ${s.name}`}
                title={readOnly ? 'Read-only' : 'Change color'}
                disabled={readOnly}
                onClick={(e) => {
                  e.stopPropagation();
                  if (readOnly) return;
                  setColorPickerId(colorPickerId === s.id ? null : s.id);
                }}
              />
              <label
                className="scenario-row__compare"
                title={isActive ? 'Active scenario is always compared' : 'Overlay on chart'}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={inCompare}
                  disabled={isActive}
                  onChange={() => onToggleCompare(s.id)}
                />
              </label>
              {renamingId === s.id && !readOnly ? (
                <RenameInput
                  initial={s.name}
                  onCommit={(name) => {
                    if (name.trim()) onRename(s.id, name.trim());
                    setRenamingId(null);
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <button
                  type="button"
                  className="scenario-row__name"
                  onClick={() => onActivate(s.id)}
                  onDoubleClick={() => { if (!readOnly) setRenamingId(s.id); }}
                  title={readOnly ? 'Click to view' : 'Click to activate, double-click to rename'}
                >
                  {s.name}
                </button>
              )}
              <div className="scenario-row__actions">
                <button
                  type="button"
                  className="scenario-row__icon-btn"
                  title={readOnly ? 'Read-only' : 'Rename'}
                  aria-label={`Rename ${s.name}`}
                  disabled={readOnly}
                  onClick={() => setRenamingId(s.id)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="scenario-row__icon-btn scenario-row__icon-btn--danger"
                  title={readOnly ? 'Read-only' : (scenarios.length <= 1 ? 'Cannot delete last scenario' : 'Delete')}
                  aria-label={`Delete ${s.name}`}
                  disabled={readOnly || scenarios.length <= 1}
                  onClick={() => {
                    if (window.confirm(`Delete scenario "${s.name}"?`)) onDelete(s.id);
                  }}
                >
                  ×
                </button>
              </div>
              {colorPickerId === s.id && (
                <div className="scenario-row__palette" onClick={(e) => e.stopPropagation()}>
                  {SCENARIO_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`scenario-row__palette-swatch ${c === s.color ? 'is-selected' : ''}`}
                      style={{ background: c }}
                      aria-label={`Use color ${c}`}
                      onClick={() => {
                        onColorChange(s.id, c);
                        setColorPickerId(null);
                      }}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="scenarios__footer">
        <button
          type="button"
          className="scenarios__btn"
          onClick={() => onAdd()}
          disabled={readOnly}
          title={readOnly ? 'Read-only profile' : undefined}
        >
          + New
        </button>
        <button
          type="button"
          className="scenarios__btn"
          onClick={onDuplicate}
          disabled={readOnly}
          title={readOnly ? 'Read-only profile' : undefined}
        >
          Duplicate
        </button>
      </div>
    </div>
  );
};

interface RenameInputProps {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

const RenameInput: React.FC<RenameInputProps> = ({ initial, onCommit, onCancel }) => {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      className="scenario-row__rename"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value);
        else if (e.key === 'Escape') onCancel();
      }}
    />
  );
};
