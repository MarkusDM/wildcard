import { motion } from 'framer-motion';

interface PlayingCardProps {
  code: string;
  concealed?: boolean;
  small?: boolean;
  animated?: boolean;
  playable?: boolean;
  selected?: boolean;
  dealIndex?: number;
  className?: string;
}

const SUIT_SYMBOLS: Record<string, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

export function PlayingCard({
  code,
  concealed = false,
  small = false,
  animated = true,
  playable = false,
  selected = false,
  dealIndex = 0,
  className = '',
}: PlayingCardProps) {
  const stateClassName = [
    'playing-card',
    concealed ? 'card-back' : '',
    small ? 'card-small' : '',
    playable ? 'playing-card--playable' : '',
    selected ? 'playing-card--selected' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const delay = Math.min(dealIndex * 0.08, 0.36);

  if (concealed) {
    return (
      <motion.div
        className={stateClassName}
        style={{
          transformStyle: 'preserve-3d',
          willChange: animated ? 'transform, opacity' : undefined,
        }}
        initial={animated ? { rotateY: 142, scale: 0.96, opacity: 0.2, y: 6 } : undefined}
        animate={animated ? { rotateY: 0, scale: 1, opacity: 1, y: 0 } : undefined}
        whileHover={playable ? { y: -12, scale: 1.035, rotateZ: -1 } : { y: -6, scale: 1.015 }}
        transition={{ duration: 0.58, delay, ease: [0.22, 1, 0.36, 1] }}
      />
    );
  }

  const normalizedCode = code.toUpperCase();
  const rankCode =
    normalizedCode.length === 3 ? normalizedCode.slice(0, 2) : normalizedCode.slice(0, 1);
  const rank = rankCode === 'T' ? '10' : rankCode;
  const suit = code.slice(rankCode.length, rankCode.length + 1).toLowerCase();
  const symbol = SUIT_SYMBOLS[suit] ?? '?';
  const isRed = suit === 'h' || suit === 'd';

  return (
    <motion.div
      className={stateClassName}
      data-suit={suit}
      data-playable={playable ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      style={{
        transformStyle: 'preserve-3d',
        willChange: animated ? 'transform, opacity' : undefined,
      }}
      initial={animated ? { rotateY: -106, scale: 0.94, opacity: 0, y: 10 } : undefined}
      animate={animated ? { rotateY: 0, scale: 1, opacity: 1, y: 0 } : undefined}
      whileHover={playable ? { y: -14, scale: 1.04, rotateZ: -1 } : { y: -7, scale: 1.018 }}
      transition={{ duration: 0.62, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className={`card-corner ${isRed ? 'red' : ''}`}>
        <span>{rank}</span>
      </span>
      <div className="card-center">
        <span className={`card-symbol ${isRed ? 'red' : ''}`}>{symbol}</span>
      </div>
      <span className={`card-corner card-corner-bottom ${isRed ? 'red' : ''}`}>
        <span>{rank}</span>
      </span>
    </motion.div>
  );
}
