import React, { useState } from 'react';
import { Button } from '../ui/button';
import { FileText, Loader2 } from 'lucide-react';

interface ExportPdfButtonProps {
  selectedYear?: number;
}

export const ExportPdfButton = ({ 
  selectedYear = new Date().getFullYear()
}: ExportPdfButtonProps) => {
  const [isExporting, setIsExporting] = useState(false);

  const optimizeForPrint = () => {
    // Récupérer toutes les cartes
    const cards = document.querySelectorAll('.card, [class*="Card"]');
    
    // Hauteur d'une page A4 en pixels (environ 1123px à 96dpi)
    // Avec marges de 12mm en haut/bas = environ 1080px utilisables
    const pageHeight = 1080;
    
    let currentPagePosition = 0;
    
    cards.forEach((card, index) => {
      const htmlCard = card as HTMLElement;
      
      // Réinitialiser les styles de saut de page
      htmlCard.style.pageBreakBefore = 'auto';
      htmlCard.style.breakBefore = 'auto';
      
      // Attendre que le DOM soit stable
      setTimeout(() => {
        const cardHeight = htmlCard.offsetHeight;
        const cardRect = htmlCard.getBoundingClientRect();
        
        console.log(`Carte ${index}: hauteur=${cardHeight}px, position=${currentPagePosition}px`);
        
        // Si la carte ne rentre pas dans la page actuelle
        if (currentPagePosition + cardHeight > pageHeight) {
          console.log(`→ Saut de page AVANT la carte ${index}`);
          htmlCard.style.pageBreakBefore = 'always';
          htmlCard.style.breakBefore = 'always';
          currentPagePosition = cardHeight; // Nouvelle page
        } else {
          currentPagePosition += cardHeight + 12; // +12 pour la marge
        }
        
        // Toujours empêcher la coupure DANS la carte
        htmlCard.style.pageBreakInside = 'avoid';
        htmlCard.style.breakInside = 'avoid';
      }, 100);
    });
  };

  const handleExportPDF = () => {
    setIsExporting(true);
    
    try {
      // 1. Optimiser la pagination
      optimizeForPrint();
      
      // 2. Attendre que l'optimisation soit appliquée
      setTimeout(() => {
        // 3. Configurer le titre
        const originalTitle = document.title;
        document.title = `Rapport_Statistiques_${selectedYear}`;
        
        // 4. Lancer l'impression
        window.print();
        
        // 5. Restaurer
        setTimeout(() => {
          document.title = originalTitle;
          setIsExporting(false);
        }, 500);
      }, 500); // Attendre 500ms pour que l'optimisation soit appliquée
      
    } catch (error) {
      console.error('Erreur lors de l\'export PDF:', error);
      alert('Une erreur est survenue lors de l\'export. Veuillez réessayer.');
      setIsExporting(false);
    }
  };

  return (
    <Button 
      onClick={handleExportPDF} 
      className="flex items-center gap-2 no-print"
      variant="outline"
      disabled={isExporting}
    >
      {isExporting ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          Préparation...
        </>
      ) : (
        <>
          <FileText size={16} />
          Exporter en PDF
        </>
      )}
    </Button>
  );
};
