import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Enquete, CompteRendu } from '@/types/interfaces';
import { useAudience } from '@/hooks/useAudience';
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';
import { ViewAudienceResultModal } from '../modals/ViewAudienceResultModal';
import { EnqueteDetailModal } from '../modals/EnqueteDetailModal';
import { AudienceResultModal } from '../modals/AudienceResultModal';
import { EditPendingAudienceModal } from '../modals/EditPendingAudienceModal';
import { RotateCcw, Trash, Gavel, FileText, ArrowUpRight, Clock, AlertCircle, Plus, Edit } from 'lucide-react';
import { Badge } from '../ui/badge';
import { ClassementModal } from '../modals/ClassementModal';
import { buildResultatKey } from '@/stores/useAudienceStore';


interface ArchivePageProps {
  enquetes: Enquete[];
  searchTerm: string;
  contentieuxId?: string;
  onUpdateEnquete: (id: number, data: Partial<Enquete>) => void;
  onDeleteEnquete: (id: number) => void;
  onUnarchiveEnquete: (id: number) => void;
  onAjoutCR: (enqueteId: number, cr: any) => void;
  onUpdateCR: (enqueteId: number, crId: number, cr: any) => void;
  onDeleteCR: (enqueteId: number, crId: number) => void;
}

export const ArchivePage = ({
  enquetes,
  searchTerm,
  contentieuxId,
  onUpdateEnquete,
  onDeleteEnquete,
  onUnarchiveEnquete,
  onAjoutCR,
  onUpdateCR,
  onDeleteCR
}: ArchivePageProps) => {
  const { showToast } = useToast();
  const { hasResultat, isLoading, audienceState, getResultat, saveResultat } = useAudience();
  const { natinfForTag } = useInfractionNatinf();

  // Contentieux courant — fallback `crimorg` pour les vues legacy.
  const ctxId = contentieuxId || 'crimorg';
  // Lookup d'un résultat par son enqueteId (numérique) en utilisant la clé
  // composite. Centralisé pour ne pas répéter `audienceState.resultats[buildResultatKey(...)]`.
  const lookupResultat = (itemId: number) =>
    audienceState?.resultats?.[buildResultatKey(ctxId, itemId)];
  const [selectedEnquete, setSelectedEnquete] = useState<Enquete | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCR, setEditingCR] = useState<CompteRendu | null>(null);
  const [viewResultat, setViewResultat] = useState<number | null>(null);
  const [showResultModal, setShowResultModal] = useState<number | null>(null);
  const [showDirectResultModal, setShowDirectResultModal] = useState(false);
  const [showEditPendingModal, setShowEditPendingModal] = useState(false);
  const [editingPendingId, setEditingPendingId] = useState<number | null>(null);
  
  // Synchronisation de selectedEnquete avec les modifications dans enquetes
  useEffect(() => {
    if (selectedEnquete) {
      const updatedEnquete = enquetes.find(e => e.id === selectedEnquete.id);
      if (updatedEnquete && updatedEnquete.dateMiseAJour !== selectedEnquete.dateMiseAJour) {
        setSelectedEnquete(updatedEnquete);
      }
    }
  }, [enquetes, selectedEnquete]);
  
  // Filtrer les enquêtes archivées et appliquer la recherche
  // Liste dédupliquée de tous les noms de MEC connus (cross-dossiers)
  const allKnownMec = useMemo(
    () => [...new Set(enquetes.flatMap(e => e.misEnCause.map(m => m.nom)))].sort(),
    [enquetes]
  );

  const archivedEnquetes = useMemo(() => {
    const archived = enquetes.filter(e => e.statut === 'archive');
    
    // Si pas de terme de recherche, retourner toutes les enquêtes archivées
    if (!searchTerm || searchTerm.trim() === '') {
      return archived;
    }

    // Appliquer le filtre de recherche (même logique que useFilterSort)
    const searchTermLower = searchTerm.toLowerCase().trim();
    
    return archived.filter(e => {
      return (
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
        (e.geolocalisations?.some(geo => 
          geo.objet.toLowerCase().includes(searchTermLower) ||
          geo.description?.toLowerCase().includes(searchTermLower)
        ) || false) ||

        // Écoutes
        (e.ecoutes?.some(ecoute => 
          ecoute.numero.toLowerCase().includes(searchTermLower) ||
          ecoute.cible?.toLowerCase().includes(searchTermLower) ||
          ecoute.description?.toLowerCase().includes(searchTermLower)
        ) || false) ||

        // Autres actes
        (e.actes?.some(acte => 
          acte.type.toLowerCase().includes(searchTermLower) ||
          acte.description.toLowerCase().includes(searchTermLower)
        ) || false)
      );
    });
  }, [enquetes, searchTerm]);
  
  // Récupérer les flagrances "orphelines" (procédures de permanence sans enquête correspondante)
  // Uniquement pour crimorg — les procédures de permanence sont un héritage de cette subdivision.
  // Filtre supplémentaire par `contentieuxId` du résultat (legacy → crimorg) pour
  // ne pas remonter une éventuelle flagrance d'un autre contentieux.
  const orphanedFlagrances = (ctxId !== 'crimorg' ? [] : Object.values(audienceState?.resultats || {})
    .filter(r => r.isDirectResult === true && (r.contentieuxId || 'crimorg') === 'crimorg')
    .filter(r => !archivedEnquetes.some(e => e.id === r.enqueteId)))
    .map(r => ({
      // Créer un objet "enquête-like" pour les flagrances orphelines
      id: r.enqueteId,
      numero: `Permanence ${new Date(r.dateAudience).toLocaleDateString()}`,
      statut: 'archive' as const,
      services: r.service ? [r.service] : [],
      misEnCause: r.condamnations.map((c, idx) => ({
        id: idx,
        nom: c.nom || 'Inconnu',
        role: '',
        statut: 'condamne'
      })),
      tags: [{ id: 'flagrance', value: r.typeInfraction || 'Flagrance', category: 'infractions' as const }],
      comptesRendus: [],
      dateDebut: r.dateAudience,
      dateCreation: r.dateAudience,
      dateMiseAJour: r.dateAudience,
      description: '',
      geolocalisations: [],
      ecoutes: [],
      actes: [],
      notes: '',
      documents: [],
      cheminBase: ''
    }));
  
  // Combiner les enquêtes archivées avec les flagrances orphelines
  const allArchivedItems = [...archivedEnquetes, ...orphanedFlagrances];

  // ====== FONCTIONS UTILITAIRES (définies en premier) ======
  
  // Fonction pour vérifier si c'est une flagrance (même critère que PermanencePage.tsx)
  const isFlagrance = (itemId: number): boolean => {
    return lookupResultat(itemId)?.isDirectResult === true;
  };

  // Fonctions pour déterminer le type de résultat
  const isOI = (itemId: number): boolean => {
    return lookupResultat(itemId)?.isOI === true;
  };

  const isPending = (itemId: number): boolean => {
    return lookupResultat(itemId)?.isAudiencePending === true;
  };

  const isClassement = (itemId: number): boolean => {
    return lookupResultat(itemId)?.isClassement === true;
  };

  const isPartiallyPending = (itemId: number): boolean => {
    return lookupResultat(itemId)?.isPartiallyPending === true;
  };

  // Fonction pour obtenir les noms des condamnés en attente
  const getPendingNames = (itemId: number): string => {
    const resultat = lookupResultat(itemId);
    if (!resultat?.pendingCondamnations) return '';
    return resultat.pendingCondamnations.map(p => p.nom).join(', ');
  };

  // Fonction pour obtenir la prochaine date d'audience en attente
  const getNextPendingDate = (itemId: number): string => {
    const resultat = lookupResultat(itemId);
    if (!resultat?.pendingCondamnations || resultat.pendingCondamnations.length === 0) return '';
    const dates = resultat.pendingCondamnations
      .map(p => p.dateAudiencePending)
      .filter(d => d)
      .sort();
    return dates[0] || '';
  };

  // Fonction pour vérifier si l'audience est passée
  const isAudiencePassed = (itemId: number): boolean => {
    const resultat = lookupResultat(itemId);
    if (!resultat?.dateAudience) return false;

    const audienceDate = new Date(resultat.dateAudience);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return audienceDate < today;
  };

  // Fonction pour obtenir les noms des condamnés depuis les résultats d'audience
  const getCondamnesNames = (itemId: number): string => {
    const resultat = lookupResultat(itemId);
    if (!resultat?.condamnations || resultat.condamnations.length === 0) return '';
    return resultat.condamnations
      .map(c => c.nom)
      .filter(nom => nom)
      .join(', ');
  };

  // Fonction pour obtenir le service enquêteur
  const getServiceEnqueteur = (item: any): string => {
    // D'abord vérifier dans les résultats d'audience
    const service = lookupResultat(item.id)?.service;
    if (service) return service;
    // Sinon, utiliser les services de l'enquête
    if (item.services && item.services.length > 0) {
      return item.services.filter(Boolean).join(' / ');
    }
    return '';
  };

  // ====== TRAITEMENT DES DONNÉES ======
  
  // Séparer les enquêtes en attente de résultats des enquêtes terminées
  const pendingEnquetes = allArchivedItems.filter(item => {
    const resultat = lookupResultat(item.id);
    if (!resultat) return false;
    return resultat.isAudiencePending === true || resultat.isPartiallyPending === true;
  });

  const completedEnquetes = allArchivedItems.filter(item => {
    const resultat = lookupResultat(item.id);
    if (!resultat) return true;
    return resultat.isAudiencePending !== true; // Inclut les partiellement terminées
  });

  // Grouper les enquêtes terminées par mois/année de la date de clôture
  const groupedCompletedEnquetes = completedEnquetes.reduce((acc, item) => {
    // Utiliser la date de clôture de l'enquête (quand elle a été archivée)
    let clotureDateToUse;
    const resultat = lookupResultat(item.id);

    // Pour les flagrances orphelines, utiliser la dateAudience comme date de clôture
    if (isFlagrance(item.id) && resultat) {
      clotureDateToUse = new Date(resultat.dateAudience);
    }
    // Pour les enquêtes avec résultat d'audience, utiliser la date d'audience (plus pertinente que dateMiseAJour)
    else if (resultat?.dateAudience) {
      clotureDateToUse = new Date(resultat.dateAudience);
    }
    // Pour les enquêtes sans résultat (ne devrait pas arriver), utiliser dateMiseAJour
    else {
      clotureDateToUse = new Date(item.dateMiseAJour);
    }

    const monthYear = `${clotureDateToUse.toLocaleDateString('fr-FR', { month: 'long' })} ${clotureDateToUse.getFullYear()}`;
    
    if (!acc[monthYear]) {
      acc[monthYear] = [];
    }
    acc[monthYear].push(item);
    return acc;
  }, {} as Record<string, typeof completedEnquetes>);

  // Trier les mois par ordre antichronologique (plus récent en haut)
  const sortedMonths = Object.keys(groupedCompletedEnquetes).sort((a, b) => {
    // Récupérer la date de clôture réelle de la première enquête de chaque groupe
    const getClotureDate = (monthKey: string) => {
      const firstItem = groupedCompletedEnquetes[monthKey][0];
      const resultat = lookupResultat(firstItem.id);
      if (isFlagrance(firstItem.id) && resultat) {
        return new Date(resultat.dateAudience);
      } else if (resultat?.dateAudience) {
        return new Date(resultat.dateAudience);
      } else {
        return new Date(firstItem.dateMiseAJour);
      }
    };
    
    const dateA = getClotureDate(a);
    const dateB = getClotureDate(b);
    return dateB.getTime() - dateA.getTime();
  });

  // ====== FONCTIONS HANDLERS ======
  
  const formatAudienceType = (itemId: number): JSX.Element | null => {
    const resultat = lookupResultat(itemId);
    if (!resultat) return null;
    
    // Vérifier si c'est un classement sans suite
    if (resultat.isClassement) {
      return (
        <Badge 
          variant="outline" 
          className="bg-red-100 text-red-800 border-red-200 text-xs px-1.5 py-0"
        >
          CSS
        </Badge>
      );
    }
    
    // Vérifier si c'est une ouverture d'information
    if (resultat.isOI) {
      return (
        <Badge 
          variant="outline" 
          className="bg-purple-100 text-purple-800 border-purple-200 text-xs px-1.5 py-0"
        >
          OI
        </Badge>
      );
    }
    
    // Vérifier s'il y a des condamnations et des types d'audience
    const audienceTypes = resultat.condamnations
      .map(c => c.typeAudience)
      .filter(Boolean);
    
    if (audienceTypes.length === 0) return null;
    
    // Compter les occurrences de chaque type
    const typeCounts = audienceTypes.reduce((acc, type) => {
      acc[type!] = (acc[type!] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Créer les badges
    return (
      <>
        {Object.entries(typeCounts).map(([type, count]) => (
          <Badge 
            key={type}
            variant="outline" 
            className="bg-blue-100 text-blue-800 border-blue-200 text-xs px-1.5 py-0"
          >
            {type}{count > 1 ? ` (${count})` : ''}
          </Badge>
        ))}
      </>
    );
  };

  const handleSaveResults = async (enqueteId: number, resultat: any) => {
    try {
      await saveResultat({ ...resultat, enqueteId, contentieuxId: ctxId });
      setShowResultModal(null);
      window.dispatchEvent(new Event('audience-stats-update'));
      showToast('Résultats mis à jour avec succès', 'success');
    } catch (error) {
      showToast('Erreur lors de la mise à jour', 'error');
    }
  };

  const handleSaveDirectResult = async (resultat: any) => {
    try {
      // Créer un résultat avec un enqueteId unique
      const directResultat = {
        ...resultat,
        isDirectResult: true,
        contentieuxId: ctxId,
        enqueteId: Math.floor(Math.random() * 1e15) + Date.now()
      };

      await saveResultat(directResultat);
      setShowDirectResultModal(false);
      showToast('Procédure de permanence enregistrée avec succès', 'success');
    } catch (error) {
      showToast('Erreur lors de l\'enregistrement', 'error');
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 px-3 lg:px-6">
      {/* Colonne de gauche : Audiences en attente */}
      <div className="w-full lg:w-72 lg:flex-shrink-0">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-700">
                Audiences en attente
              </CardTitle>
              {pendingEnquetes.length > 0 && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                  {pendingEnquetes.length}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-1 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto">
            {pendingEnquetes.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">Aucune audience en attente</p>
            ) : (
              pendingEnquetes.map(item => {
                const isPartialResult = isPartiallyPending(item.id);
                const audienceDate = lookupResultat(item.id)?.dateAudience;
                const isPassed = audienceDate && isAudiencePassed(item.id);
                const nextPendingDate = isPartialResult ? getNextPendingDate(item.id) : null;

                return (
                  <div
                    key={item.id}
                    className={`p-2 border rounded transition-all ${
                      isPassed 
                        ? 'bg-red-50 border-red-200' 
                        : 'bg-blue-50 border-blue-200'
                    }`}
                  >
                    <div 
                      className="cursor-pointer hover:bg-opacity-80"
                      onClick={() => {
                        setShowResultModal(item.id);
                      }}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-xs truncate">{item.numero}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {item.tags
                              .filter(tag => tag.category === 'infractions')
                              .slice(0, 2)
                              .map(tag => { const n = natinfForTag(tag.value); return n ? `${tag.value} (${n.code})` : tag.value; })
                              .join(', ')}
                            {item.tags.filter(tag => tag.category === 'infractions').length > 2 && '...'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {isPartialResult && (
                            <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 text-xs px-1.5 py-0 flex-shrink-0">
                              Partiel
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-white/50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEnquete(item);
                            }}
                            title="Voir le détail de l'enquête"
                          >
                            <FileText className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-white/50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPendingId(item.id);
                              setShowEditPendingModal(true);
                            }}
                            title="Modifier audience et défèrement"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-600">
                        <Clock className={`h-3 w-3 flex-shrink-0 ${isPassed ? 'text-red-600' : ''}`} />
                        <span className="truncate">
                          {audienceDate ? new Date(audienceDate).toLocaleDateString() : 'Date inconnue'}
                          {isPassed && ' (passée)'}
                        </span>
                      </div>
                      {isPartialResult && nextPendingDate && (
                        <div className="flex items-center gap-1 text-xs text-blue-700 mt-1">
                          <AlertCircle className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">
                            Prochaine : {new Date(nextPendingDate).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                      {isPartialResult && getPendingNames(item.id) && (
                        <div className="text-xs text-blue-700 mt-1 truncate">
                          En attente: {getPendingNames(item.id)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Colonne de droite : Enquêtes terminées */}
      <div className="flex-1 space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-120px)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-700">Préliminaires terminées</h2>
          {completedEnquetes.length > 0 && (
            <Badge variant="secondary" className="bg-gray-100 text-gray-700">
              {completedEnquetes.length} affaire{completedEnquetes.length > 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        <div className="space-y-3">
          {sortedMonths.length === 0 ? (
            <Card className="p-8">
              <p className="text-center text-gray-500">Aucune enquête terminée</p>
            </Card>
          ) : (
            sortedMonths.map(monthYear => (
              <Card key={monthYear} className="shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-gray-700 capitalize">
                      {monthYear}
                    </CardTitle>
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">
                      {groupedCompletedEnquetes[monthYear].length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  {groupedCompletedEnquetes[monthYear]
                    .sort((a, b) => {
                      const dateA = lookupResultat(a.id)?.dateAudience
                        ? new Date(lookupResultat(a.id)!.dateAudience).getTime()
                        : new Date(a.dateMiseAJour).getTime();
                      const dateB = lookupResultat(b.id)?.dateAudience
                        ? new Date(lookupResultat(b.id)!.dateAudience).getTime()
                        : new Date(b.dateMiseAJour).getTime();
                      return dateB - dateA;
                    })
                    .map(item => {
                      const itemResultat = lookupResultat(item.id);
                      const audienceDate = itemResultat?.dateAudience
                        ? new Date(itemResultat.dateAudience).toLocaleDateString()
                        : null;
                      
                      const isOIResult = isOI(item.id);
                      const isClassementResult = isClassement(item.id);
                      const isFlagranceResult = isFlagrance(item.id);
                      const isPartialResult = isPartiallyPending(item.id);
                      
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 p-2 border rounded hover:bg-gray-50 transition-colors ${
                            isOIResult ? 'bg-purple-50' : 
                            isClassementResult ? 'bg-red-50' : 
                            isPartialResult ? 'bg-blue-50' : ''
                          }`}
                          onClick={() => {
                            // Ne pas ouvrir la modal pour les flagrances orphelines
                            if (!isFlagranceResult) {
                              setSelectedEnquete(item as Enquete);
                              setIsEditing(false);
                            }
                          }}
                        >
                          <div className="flex-1 min-w-0 mr-2">
                            <div className="font-medium flex items-center gap-1.5">
                              <span className="truncate">{item.numero}</span>
                              {isPartialResult && (
                                <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 text-xs px-1.5 py-0">
                                  Partiel
                                </Badge>
                              )}
                              {formatAudienceType(item.id)}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {item.tags
                                .filter(tag => tag.category === 'infractions')
                                .slice(0, 2)
                                .map(tag => { const n = natinfForTag(tag.value); return n ? `${tag.value} (${n.code})` : tag.value; })
                                .join(', ')}
                              {item.tags.filter(tag => tag.category === 'infractions').length > 2 && '...'}
                              {isPartialResult && getPendingNames(item.id) && (
                                <span className="ml-1 text-blue-700 font-medium">
                                  • En attente: {getPendingNames(item.id)}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex-1 text-sm text-gray-600 px-2 min-w-0">
                            {(audienceDate && !isClassementResult) && (
                              <div className="text-xs flex items-center">
                                <span className="text-gray-500 whitespace-nowrap mr-1">Audience:</span> 
                                <span className="truncate">{audienceDate}</span>
                              </div>
                            )}
                            {isClassementResult && (
                              <div className="text-xs flex items-center">
                                <span className="text-gray-500 whitespace-nowrap mr-1">Classement:</span> 
                                <span className="truncate">{audienceDate}</span>
                              </div>
                            )}
                            {getServiceEnqueteur(item) && (
                              <div className="text-xs flex items-center">
                                <span className="text-gray-500 whitespace-nowrap mr-1">Service:</span>
                                <span className="truncate">{getServiceEnqueteur(item)}</span>
                              </div>
                            )}
                            {getCondamnesNames(item.id) ? (
                              <div className="text-xs flex items-center">
                                <span className="text-gray-500 whitespace-nowrap mr-1">Condamnés:</span>
                                <span className="truncate">{getCondamnesNames(item.id)}</span>
                              </div>
                            ) : (
                              <div className="text-xs flex items-center">
                                <span className="text-gray-500 whitespace-nowrap mr-1">MEC:</span>
                                <span className="truncate">{item.misEnCause.map(mec => mec.nom).join(', ')}</span>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex gap-1 flex-shrink-0">
                            {!isLoading && hasResultat(ctxId, item.id) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-8 w-8 p-0 ${
                                  isOIResult ? 'text-purple-600' : 
                                  isClassementResult ? 'text-red-600' : 
                                  isPartialResult ? 'text-blue-600' : ''
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewResultat(item.id);
                                }}
                                title={
                                  isOIResult ? "Voir l'ouverture d'information" : 
                                  isClassementResult ? "Voir le classement sans suite" :
                                  isPartialResult ? "Compléter les résultats partiels" : 
                                  "Voir les résultats"
                                }
                              >
                                {isOIResult || isClassementResult || isPartialResult ? <ArrowUpRight className="h-4 w-4" /> : <Gavel className="h-4 w-4" />}
                              </Button>
                            )}
                            {item.comptesRendus && item.comptesRendus.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-gray-500"
                                title={`${item.comptesRendus.length} CR(s)`}
                              >
                                <FileText className="h-4 w-4" />
                              </Button>
                            )}
                            {!isFlagranceResult && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUnarchiveEnquete(item.id);
                                  }}
                                  title="Désarchiver"
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-red-500"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteEnquete(item.id);
                                  }}
                                  title="Supprimer"
                                >
                                  <Trash className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Bouton flottant pour ajouter une procédure de permanence — crimorg uniquement */}
      {contentieuxId === 'crimorg' && (
        <Button
          onClick={() => setShowDirectResultModal(true)}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg bg-orange-600 hover:bg-orange-700 text-white z-50"
          title="Ajouter une procédure de permanence"
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}
      
      {/* Modales */}
      {selectedEnquete && (
        <EnqueteDetailModal
          enquete={selectedEnquete}
          contentieuxId={ctxId}
          isEditing={isEditing}
          editingCR={editingCR}
          onClose={() => setSelectedEnquete(null)}
          onEdit={() => setIsEditing(!isEditing)}
          onUpdate={(id, updates) => onUpdateEnquete(id, updates)}
          onAddCR={(cr) => onAjoutCR(selectedEnquete.id, cr)}
          onUpdateCR={(crId, cr) => onUpdateCR(selectedEnquete.id, crId, cr)}
          onDeleteCR={(crId) => onDeleteCR(selectedEnquete.id, crId)}
          setEditingCR={setEditingCR}
          onDelete={() => onDeleteEnquete(selectedEnquete.id)}
          allKnownMec={allKnownMec}
        />
      )}
      
      {viewResultat && (
        <ViewAudienceResultModal
          isOpen={!!viewResultat}
          onClose={() => setViewResultat(null)}
          enqueteId={viewResultat}
          contentieuxId={ctxId}
          misEnCause={allArchivedItems.find(e => e.id === viewResultat)?.misEnCause}
          enqueteTags={allArchivedItems.find(e => e.id === viewResultat)?.tags}
        />
      )}

      {showResultModal && (
        <AudienceResultModal
          isOpen={!!showResultModal}
          onClose={() => setShowResultModal(null)}
          enqueteId={showResultModal}
          contentieuxId={ctxId}
          onSave={(resultat) => handleSaveResults(showResultModal, resultat)}
          defaultDate={lookupResultat(showResultModal)?.dateAudience || ''}
          initialData={lookupResultat(showResultModal)}
          misEnCause={allArchivedItems.find(e => e.id === showResultModal)?.misEnCause}
          enqueteTags={allArchivedItems.find(e => e.id === showResultModal)?.tags}
        />
      )}

      {showDirectResultModal && (
        <AudienceResultModal
          isOpen={showDirectResultModal}
          onClose={() => setShowDirectResultModal(false)}
          onSave={handleSaveDirectResult}
          enqueteId={Date.now()}
          contentieuxId={ctxId}
          isDirectResult={true}
        />
      )}

      {showEditPendingModal && editingPendingId && (
        <EditPendingAudienceModal
          isOpen={showEditPendingModal}
          onClose={() => {
            setShowEditPendingModal(false);
            setEditingPendingId(null);
          }}
          enqueteId={editingPendingId}
          contentieuxId={ctxId}
        />
      )}
    </div>
  );
};