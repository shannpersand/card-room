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
    sm: 'w-9 h-14 text-xs',
    md: 'w-14 h-20 text-sm',
    lg: 'w-16 h-24 text-base',
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
        <div className="text-sm leading-none">{card.rank}</div>
        <div className="leading-none">{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div className="self-center text-xl leading-none">{SUIT_SYMBOLS[card.suit]}</div>
      <div className="font-bold leading-none font-card rotate-180 self-end">
        <div className="text-sm leading-none">{card.rank}</div>
        <div className="leading-none">{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
}
