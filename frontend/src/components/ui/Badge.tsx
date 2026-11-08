import type { ReactNode } from 'react';

type Tone = 'neutral' | 'gold' | 'green' | 'blue' | 'red' | 'violet';

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <i className="badge__dot" />}
      {children}
    </span>
  );
}
