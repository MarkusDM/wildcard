import { motion } from 'framer-motion';
import type { MagicCardType } from '../../shared/socket-events';

interface MagicCardProps {
  type: MagicCardType;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

const LABELS: Record<MagicCardType, { title: string; subtitle: string }> = {
  peek: { title: 'Peek', subtitle: 'Reveal 1 opponent card' },
  swap: { title: 'Swap', subtitle: 'Replace 1 own card (preflop)' },
  shield: { title: 'Shield', subtitle: 'Block next targeted magic' },
  hex: { title: 'Hex', subtitle: 'Target pays 0.2 USDC to pot' },
  drain: { title: 'Drain', subtitle: 'Steal 0.2 USDC from target' },
  reroll: { title: 'Reroll', subtitle: 'Replace both own cards preflop' },
  ward: { title: 'Ward', subtitle: 'Gain two spell blocks' },
};

export function MagicCard({ type, selected, disabled, onClick }: MagicCardProps) {
  const label = LABELS[type];

  return (
    <motion.button
      type="button"
      className={`magic-card magic-${type} ${selected ? 'magic-selected' : ''}`}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { y: -4, scale: 1.01 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
    >
      <strong>{label.title}</strong>
      <span>{label.subtitle}</span>
    </motion.button>
  );
}
