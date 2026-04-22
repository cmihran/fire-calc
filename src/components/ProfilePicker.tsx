import React, { useEffect, useRef, useState } from 'react';
import type { ProfileSummary } from '../hooks/useAppState';

interface Props {
  profiles: ProfileSummary[];
  activeProfileId: string;
  onActivate: (id: string) => void;
  onCreate: (name?: string) => void;
  onDuplicate: (name?: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export const ProfilePicker: React.FC<Props> = ({
  profiles,
  activeProfileId,
  onActivate,
  onCreate,
  onDuplicate,
  onRename,
  onDelete,
}) => {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setRenamingId(null);
      }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const editableCount = profiles.filter((p) => !p.readOnly).length;

  return (
    <div className="profile-picker" ref={rootRef}>
      <button
        type="button"
        className={`profile-picker__trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="profile-picker__trigger-icon" aria-hidden>◎</span>
        <span className="profile-picker__trigger-name">{active?.name ?? 'Profile'}</span>
        {active?.readOnly && <span className="profile-picker__badge">read-only</span>}
        <span className="profile-picker__chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="profile-picker__menu" role="menu">
          <ul className="profile-picker__list">
            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              const canDelete = !p.readOnly && editableCount > 1;
              return (
                <li
                  key={p.id}
                  className={`profile-picker__row ${isActive ? 'is-active' : ''} ${p.readOnly ? 'is-readonly' : ''}`}
                >
                  {renamingId === p.id ? (
                    <RenameInput
                      initial={p.name}
                      onCommit={(name) => {
                        if (name.trim()) onRename(p.id, name.trim());
                        setRenamingId(null);
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="profile-picker__row-name"
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => {
                        onActivate(p.id);
                        setOpen(false);
                      }}
                    >
                      <span className="profile-picker__row-dot" aria-hidden>
                        {isActive ? '●' : '○'}
                      </span>
                      <span className="profile-picker__row-text">{p.name}</span>
                      {p.readOnly && <span className="profile-picker__badge profile-picker__badge--inline">read-only</span>}
                    </button>
                  )}
                  {!p.readOnly && (
                    <div className="profile-picker__row-actions">
                      <button
                        type="button"
                        className="profile-picker__icon-btn"
                        title="Rename profile"
                        aria-label={`Rename ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(p.id);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="profile-picker__icon-btn profile-picker__icon-btn--danger"
                        title={canDelete ? 'Delete profile' : 'Cannot delete last editable profile'}
                        aria-label={`Delete ${p.name}`}
                        disabled={!canDelete}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete profile "${p.name}"? This removes all its scenarios.`)) {
                            onDelete(p.id);
                          }
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="profile-picker__footer">
            <button
              type="button"
              className="profile-picker__btn"
              onClick={() => {
                onCreate();
                setOpen(false);
              }}
            >
              + New profile
            </button>
            <button
              type="button"
              className="profile-picker__btn"
              onClick={() => {
                onDuplicate();
                setOpen(false);
              }}
            >
              Duplicate current
            </button>
          </div>
        </div>
      )}
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
      className="profile-picker__rename"
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
