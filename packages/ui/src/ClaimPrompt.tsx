import { useState } from 'react';
import type { Player } from '@sussed/player';
import { Sheet } from './Sheet';

/**
 * The T2 moment, and the most carefully judged screen in the studio.
 *
 * Rules it follows:
 *   - It never appears before the player has something worth keeping.
 *   - The headline is the concrete fact about *their* situation, passed in by
 *     the caller. Never "Create an account".
 *   - Dismissing costs nothing and it does not nag again this session.
 *   - Passkey first, email second, and the email field is not even rendered
 *     until they ask for it.
 */
export function ClaimPrompt({
  player,
  message,
  onDone,
}: {
  player: Player;
  message: string;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'passkey' | 'email'>('passkey');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      setError('Pick a name to appear on the board.');
      return;
    }
    setBusy(true);
    setError(null);
    const ok =
      mode === 'passkey'
        ? await player.claimWithPasskey(name.trim())
        : await player.claimWithEmail(email.trim(), name.trim());
    setBusy(false);
    if (!ok) {
      setError(
        mode === 'passkey'
          ? "That didn't take. Try the email option instead."
          : "Couldn't send that. Check the address and try again.",
      );
      return;
    }
    if (mode === 'email') setSent(true);
    else onDone();
  };

  return (
    <Sheet open onClose={onDone} title="Keep this">
      <p style={{ margin: '0 0 6px', fontSize: 18, lineHeight: 1.4 }}>{message}</p>
      <p style={{ margin: '0 0 18px', color: 'var(--s-ink-2)', fontSize: 15 }}>
        Save it and your history follows you to any device. No password, no email needed.
      </p>

      {sent ? (
        <p style={{ color: 'var(--s-good)', fontWeight: 600 }}>
          Check your inbox — the link signs you in and brings your history with it.
        </p>
      ) : (
        <>
          <label className="s-sub" htmlFor="claim-name">
            Name on the board
          </label>
          <input
            id="claim-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
            placeholder="e.g. victor"
            style={inputStyle}
          />

          {mode === 'email' && (
            <>
              <label className="s-sub" htmlFor="claim-email">
                Email for the sign-in link
              </label>
              <input
                id="claim-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                style={inputStyle}
              />
            </>
          )}

          {error && (
            <p role="alert" style={{ color: 'var(--s-accent)', fontSize: 14, margin: '0 0 12px' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="s-btn s-btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'One moment…' : mode === 'passkey' ? 'Save with Face ID' : 'Send me a link'}
            </button>
            <button
              className="s-btn s-btn-quiet"
              onClick={() => setMode(mode === 'passkey' ? 'email' : 'passkey')}
            >
              {mode === 'passkey' ? 'Use email instead' : 'Use Face ID instead'}
            </button>
            <span className="s-spacer" />
            <button className="s-btn s-btn-quiet" onClick={onDone}>
              Not now
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  minHeight: 'var(--s-tap)',
  margin: '6px 0 16px',
  padding: '0 12px',
  font: 'inherit',
  color: 'var(--s-ink)',
  background: 'var(--s-bg)',
  border: '1px solid var(--s-rule)',
  borderRadius: 'var(--s-radius)',
};
