import { useMemo } from 'react';
import { Enquete, Tag } from '@/types/interfaces';

export const useFilterSort = (
  enquetes: Enquete[],
  searchTerm: string,
  selectedTags: Tag[],
  sortOrder: string
) => {
  return useMemo(() => {
    // Ensure enquetes is an array
    const enquetesArray = Array.isArray(enquetes) ? enquetes : [];
    const searchTermLower = searchTerm.toLowerCase().trim();

    let filtered = enquetesArray.filter(e => {
      // Si pas de terme de recherche et pas de tags sélectionnés, retourner tout
      if (!searchTermLower && selectedTags.length === 0) return true;

      const matchesSearch = !searchTermLower || (
        // Numéro d'enquête
        e.numero.toLowerCase().includes(searchTermLower) ||

        // Services
        e.services.some(service => 
          service?.toLowerCase().includes(searchTermLower)
        ) ||

        // Tous les tags
        e.tags.some(tag => 
          tag.value.toLowerCase().includes(searchTermLower)
        ) ||

        // Description de l'enquête
        (e.description?.toLowerCase().includes(searchTermLower) || false) ||

        // Mis en cause (nom et rôle)
        e.misEnCause.some(m => 
          m.nom.toLowerCase().includes(searchTermLower) ||
          m.role?.toLowerCase().includes(searchTermLower)
        ) ||

        // Dates (format YYYY-MM-DD)
        e.dateDebut.includes(searchTermLower) ||
        e.dateCreation.includes(searchTermLower) ||

        // Comptes rendus (enquêteur et contenu)
        e.comptesRendus.some(cr => 
          cr.enqueteur.toLowerCase().includes(searchTermLower) ||
          cr.description.toLowerCase().includes(searchTermLower)
        ) ||

        // Géolocalisations
        e.geolocalisations.some(geo => 
          geo.objet.toLowerCase().includes(searchTermLower) ||
          geo.description?.toLowerCase().includes(searchTermLower)
        ) ||

        // Écoutes
        e.ecoutes.some(ecoute => 
          ecoute.numero.toLowerCase().includes(searchTermLower) ||
          ecoute.cible?.toLowerCase().includes(searchTermLower) ||
          ecoute.description?.toLowerCase().includes(searchTermLower)
        ) ||

        // Autres actes
        e.actes.some(acte => 
          acte.type.toLowerCase().includes(searchTermLower) ||
          acte.description.toLowerCase().includes(searchTermLower)
        )
      );

      // Filtrage par tags sélectionnés
      const matchesTags = selectedTags.length === 0 || 
        selectedTags.every(tag => e.tags.some(t => t.id === tag.id));

      return matchesSearch && matchesTags;
    });

    // Tri des résultats
    return filtered.sort((a, b) => {
      switch (sortOrder) {
        case 'date-asc':
          return new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime();
        case 'date-desc':
          return new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime();
        case 'cr-asc':
          return new Date(a.comptesRendus[0]?.date || 0).getTime() - 
                 new Date(b.comptesRendus[0]?.date || 0).getTime();
        case 'cr-desc':
          return new Date(b.comptesRendus[0]?.date || 0).getTime() - 
                 new Date(a.comptesRendus[0]?.date || 0).getTime();
        case 'update-asc':
          return new Date(a.dateMiseAJour).getTime() - new Date(b.dateMiseAJour).getTime();
        case 'update-desc':
          return new Date(b.dateMiseAJour).getTime() - new Date(a.dateMiseAJour).getTime();
        default:
          return 0;
      }
    });
  }, [enquetes, searchTerm, selectedTags, sortOrder]);
};