import React, { useRef, useState, useEffect, ReactElement } from 'react';

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
 * Réagit correctement aux changements de liste (filtrage, tri).
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
        // Utiliser la key React du child s'il en a une, sinon fallback sur l'index
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Observer bidirectionnel : rend visible quand entre dans le viewport,
    // garde visible une fois chargé (pas de re-placeholder pour éviter le flickering)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reset visibility quand le contenu change (filtrage/tri)
  // Le child key change → React remonte le composant → visible repart à false → observer relance

  if (!visible) {
    return <div ref={ref} style={{ minHeight: placeholderHeight }} />;
  }

  return <div ref={ref}>{children}</div>;
}
