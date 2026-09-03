import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Everything that isn't the board lives in one of these — stats, rules,
 * settings, the claim prompt. Nothing blocks the first tap; a player who never
 * opens a sheet still has the whole game.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="s-sheet"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="s-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 16 }}>
          <h2 className="s-title" style={{ fontSize: 20 }}>
            {title}
          </h2>
          <span className="s-spacer" />
          <button className="s-btn s-btn-quiet" onClick={onClose} aria-label="Close">
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
