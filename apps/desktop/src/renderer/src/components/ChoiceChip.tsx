import { useRef, useState } from 'react';
import { Button } from './Button';
import { IconChevronDown } from './icons';
import { Menu } from './Menu';

/** A small chip that opens a short menu to pick one value; the menu heading says what the choice is for (N22, D-362). */
export function ChoiceChip({ text, heading, value, options, onPick, testId }: { text: string; heading: string; value: string; options: Array<{ id: string; label: string }>; onPick(id: string): void; testId: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={anchor} className="rl-choicechip">
        <Button size="sm" aria-haspopup="menu" aria-expanded={open} title={heading} onClick={() => setOpen(!open)} data-testid={testId}>
          <span className="rl-choicechip__text">{text}</span>
          <IconChevronDown size={16} />
        </Button>
      </span>
      <Menu
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label={text}
        width={260}
        placement="top-start"
        groups={[{ id: 'choice', label: heading, items: options.map((o) => ({ id: o.id, label: o.id === value ? `✓ ${o.label}` : o.label, testId: `${testId}-${o.id}`, onSelect: () => onPick(o.id) })) }]}
      />
    </>
  );
}
