import type { ReactNode } from 'react';
import './viewHead.css';

/**
 * The header every secondary view shares (1.1, D-344): the title, a sub line in the muted colour on the same baseline,
 * and the actions on the right (one primary, at most two secondaries, then the menu).
 */
export function ViewHead({ title, titleTestId, sub, children }: { title: string; titleTestId?: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="vhead">
      <h1 data-testid={titleTestId}>{title}</h1>
      {sub !== undefined && <div className="vhead__sub">{sub}</div>}
      {children && <div className="vhead__acts">{children}</div>}
    </header>
  );
}
