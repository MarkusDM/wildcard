import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';

interface SeatProps {
  angle: number;
  isTurn: boolean;
  isSelf: boolean;
  name: string;
  status: string;
  children?: ReactNode;
}

export function Seat({ angle, isTurn, isSelf, name, status, children }: SeatProps) {
  return (
    <motion.article
      className={`seat ${isTurn ? 'seat-turn' : ''} ${isSelf ? 'seat-self' : ''}`}
      style={{ '--seat-angle': `${angle}deg` } as CSSProperties}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <header>
        <strong>{name}</strong>
        <span>{status}</span>
      </header>
      {children}
    </motion.article>
  );
}
