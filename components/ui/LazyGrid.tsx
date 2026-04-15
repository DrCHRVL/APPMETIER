import React, { useRef, useState, useEffect } from 'react';

interface LazyGridProps {
  children: React.ReactNode[];
  /** Nombre de cartes toujours rendues (sans lazy) avant d'activer la virtualisation */
  threshold?: number;
  /** Hauteur estimée d'une carte non rendue (placeholder) */
  placeholderHeight?: number;
  className?: string;
}

/**
 * Grille avec vraie virtualisation bidirectionnelle par IntersectionObserver.
 * Les cartes hors-écran sont remplacées par des placeholders ET retirées du DOM
 * quand elles sortent du viewport, libérant mémoire et réduisant les nœuds DOM.
 */
export const LazyGrid = ({
  children,
  threshold = 20,
  placeholderHeight = 280,
  className
}: LazyGridProps) => {
  // Si peu d'éléments, pas besoin de virtualiser
  if (children.length <= threshold) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className}>
      {children.map((child) => {
        const childKey = React.isValidElement(child) ? child.key : null;
        return (
          <LazyItem key={childKey ?? undefined} placeholderHeight={placeholderHeight}>
            {child}
          </LazyItem>
        );
      })}
    </div>
  );
};

function LazyItem({ children, placeholderHeight }: { children: React.ReactNode; placeholderHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const measuredHeight = useRef<number>(placeholderHeight);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Vraie virtualisation bidirectionnelle :
    // - visible quand entre dans le viewport (+ buffer 400px)
    // - retour en placeholder quand sort du viewport (+ buffer 800px)
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      { rootMargin: '400px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Mesurer la hauteur réelle quand visible pour un placeholder précis
  useEffect(() => {
    if (visible && ref.current) {
      const h = ref.current.getBoundingClientRect().height;
      if (h > 0) measuredHeight.current = h;
    }
  }, [visible]);

  if (!visible) {
    return <div ref={ref} style={{ minHeight: measuredHeight.current }} />;
  }

  return <div ref={ref}>{children}</div>;
}
