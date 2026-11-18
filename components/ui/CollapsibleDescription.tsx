import { useLayoutEffect, useRef, useState } from 'react';

interface CollapsibleDescriptionProps {
  text: string;
  className?: string;
}

/**
 * Description d'acte repliée sur 3 lignes ; « Dérouler » / « Enrouler »
 * n'apparaît que si le texte dépasse.
 */
export const CollapsibleDescription = ({ text, className = '' }: CollapsibleDescriptionProps) => {
  const [ouvert, setOuvert] = useState(false);
  const [deborde, setDeborde] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !ouvert) setDeborde(el.scrollHeight > el.clientHeight + 1);
  }, [text, ouvert]);

  return (
    <div className="mt-1">
      <p ref={ref} className={`text-sm break-words ${ouvert ? '' : 'line-clamp-3'} ${className}`}>
        {text}
      </p>
      {deborde && (
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline"
          onClick={(e) => { e.stopPropagation(); setOuvert(!ouvert); }}
        >
          {ouvert ? 'Enrouler' : 'Dérouler'}
        </button>
      )}
    </div>
  );
};
