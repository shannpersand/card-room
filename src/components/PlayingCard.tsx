import type { Card } from '@/types';
import { SUIT_SYMBOLS } from '@/lib/deck';

interface Props {
  card: Card;
  isOwner?: boolean;  // player always sees their own cards face-up
  selected?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export function PlayingCard({ card, isOwner = false, selected = false, onClick, size = 'md' }: Props) {
  const showFace = isOwner || card.faceUp;
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

  const sizeClasses = {
    sm: 'w-[4.5rem] h-28',
    md: 'w-28 h-40',
    lg: 'w-32 h-48',
  }[size];

  const faceTextClasses = {
    sm: { rank: 'text-base', suit: 'text-2xl' },
    md: { rank: 'text-lg', suit: 'text-3xl' },
    lg: { rank: 'text-xl', suit: 'text-4xl' },
  }[size];

  const baseClasses = `
    relative inline-flex flex-col select-none rounded-lg border shadow-md
    transition-all duration-150
    ${onClick ? 'cursor-pointer' : 'cursor-default'}
    ${selected ? '-translate-y-3 ring-2 ring-yellow-400 shadow-xl' : onClick ? 'hover:-translate-y-1 hover:shadow-lg' : ''}
    ${sizeClasses}
  `;

  if (!showFace) {
    return (
      <div className={`${baseClasses} bg-blue-800 border-blue-600`} onClick={onClick}>
        <div className="absolute inset-1 rounded card-back-pattern" />
        <div className="absolute inset-2 rounded border border-blue-600/40" />
      </div>
    );
  }

  return (
    <div
      className={`${baseClasses} bg-white border-gray-200 justify-between p-1 ${isRed ? 'text-red-600' : 'text-gray-900'}`}
      onClick={onClick}
    >
      <div className="font-bold leading-none font-card">
        <div className={`${faceTextClasses.rank} leading-none`}>{card.rank}</div>
        <div className="leading-none">{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div className={`self-center ${faceTextClasses.suit} leading-none`}>{SUIT_SYMBOLS[card.suit]}</div>
      <div className="font-bold leading-none font-card rotate-180 self-end">
        <div className={`${faceTextClasses.rank} leading-none`}>{card.rank}</div>
        <div className="leading-none">{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
}
