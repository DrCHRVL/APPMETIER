import React, { useEffect } from 'react';

interface PrintOptimizerProps {
  children: React.ReactNode;
}

/**
 * Composant qui optimise la pagination pour l'impression
 * Force les sauts de page intelligents pour éviter de couper les cartes
 */
export const PrintOptimizer: React.FC<PrintOptimizerProps> = ({ children }) => {
  useEffect(() => {
    // Cette fonction s'exécute avant l'impression
    const handleBeforePrint = () => {
      // Récupérer toutes les cartes
      const cards = document.querySelectorAll('.card, [class*="Card"]');
      
      cards.forEach((card) => {
        const htmlCard = card as HTMLElement;
        
        // Mesurer la hauteur de la carte
        const cardHeight = htmlCard.offsetHeight;
        const cardTop = htmlCard.offsetTop;
        
        // Hauteur d'une page A4 en pixels (environ 1123px à 96dpi)
        const pageHeight = 1123;
        
        // Calculer sur quelle page on est
        const currentPage = Math.floor(cardTop / pageHeight);
        const positionInPage = cardTop % pageHeight;
        
        // Si la carte dépasse la fin de la page
        if (positionInPage + cardHeight > pageHeight - 50) { // 50px de marge de sécurité
          // Forcer un saut de page AVANT cette carte
          htmlCard.style.pageBreakBefore = 'always';
          htmlCard.style.breakBefore = 'always';
        } else {
          // Sinon, permettre la continuité
          htmlCard.style.pageBreakBefore = 'auto';
          htmlCard.style.breakBefore = 'auto';
        }
        
        // Toujours empêcher la coupure À L'INTÉRIEUR de la carte
        htmlCard.style.pageBreakInside = 'avoid';
        htmlCard.style.breakInside = 'avoid';
      });
    };
    
    // Écouter l'événement beforeprint
    window.addEventListener('beforeprint', handleBeforePrint);
    
    // Nettoyer l'écouteur
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
    };
  }, []);
  
  return <>{children}</>;
};
