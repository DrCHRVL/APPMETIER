import React from 'react';

interface AlertBadgeProps {
  count: number;
  size?: 'sm' | 'md';
}

export const AlertBadge = ({ count, size = 'md' }: AlertBadgeProps) => {
  if (count === 0) return null;

  return (
    <div className={`
      absolute 
      ${size === 'sm' ? '-top-1 -right-1' : '-top-2 -right-2'}
      ${size === 'sm' ? 'h-4 w-4 text-[10px]' : 'h-5 w-5 text-xs'}
      bg-red-600 
      text-white 
      rounded-full 
      flex 
      items-center 
      justify-center
      font-bold
    `}>
      {count}
    </div>
  );
};