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
 * Grille légère avec virtualisation par IntersectionObserver.
 * Les cartes hors-écran sont remplacées par des placeholders.
 * Pas de dépendance externe — utilise l'API native du navigateur.
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
      {children.map((child, i) => (
        <LazyItem key={i} placeholderHeight={placeholderHeight}>
          {child}
        </LazyItem>
      ))}
    </div>
  );
};

function LazyItem({ children, placeholderHeight }: { children: React.ReactNode; placeholderHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' } // rendre 200px avant d'être visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!visible) {
    return <div ref={ref} style={{ minHeight: placeholderHeight }} />;
  }

  return <div ref={ref}>{children}</div>;
}
