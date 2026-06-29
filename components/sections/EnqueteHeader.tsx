import React, { useState, useEffect } from 'react';
import { Tag } from '@/types/interfaces';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { MultiSelect } from '../ui/multi-select';
import { Badge } from '../ui/badge';
import { Flag } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';
import { NatinfBadge } from '../natinf/NatinfBadge';
import { NatinfPicker } from '../natinf/NatinfPicker';

interface EnqueteHeaderProps {
  numero: string;
  dateDebut: string;
  services: string[];
  tags: Tag[];
  infractionNatinfCodes?: string[];
  description?: string;
  directeurEnquete?: string;
  numeroParquet?: string;
  numeroIDJ?: string;
  isEditing?: boolean;
  onUpdate?: (updates: Partial<any>) => void;
  /** Callback immédiat pour les actions discrètes (date, select) — sans debounce */
  onUpdateImmediate?: (updates: Partial<any>) => void;
}

export const EnqueteHeader = React.memo(({
  numero,
  dateDebut,
  services,
  tags,
  infractionNatinfCodes,
  description,
  directeurEnquete,
  numeroParquet,
  numeroIDJ,
  isEditing = false,
  onUpdate,
  onUpdateImmediate
}: EnqueteHeaderProps) => {
  // Pour les actions discrètes (date, select), utiliser le callback immédiat si disponible
  const discreteUpdate = onUpdateImmediate || onUpdate;
  // État local pour les champs texte : feedback instantané, propagation déboncée
  const [localDirecteur, setLocalDirecteur] = useState(directeurEnquete || '');
  const [localParquet, setLocalParquet] = useState(numeroParquet || '');
  const [localIDJ, setLocalIDJ] = useState(numeroIDJ || '');
  const [localDescription, setLocalDescription] = useState(description || '');

  // Sync depuis les props parent quand l'enquête change
  useEffect(() => { setLocalDirecteur(directeurEnquete || ''); }, [directeurEnquete]);
  useEffect(() => { setLocalParquet(numeroParquet || ''); }, [numeroParquet]);
  useEffect(() => { setLocalIDJ(numeroIDJ || ''); }, [numeroIDJ]);
  useEffect(() => { setLocalDescription(description || ''); }, [description]);

  const { getTagsByCategory, getServicesFromTags } = useTags();
  const { infractionsForEnquete } = useInfractionNatinf();
  const servicesTags = getTagsByCategory('services');
  // Infractions canoniques (NATINF natif via infractionNatinfCodes, sinon tags
  // résolus) + codes courants pour l'édition via le picker NATINF.
  const infractionItems = infractionsForEnquete({ tags, infractionNatinfCodes });
  const currentCodes = infractionItems.map(i => i.code).filter((c): c is string => Boolean(c));

  // Services dérivés depuis les tags au lieu d'utiliser props.services
  const displayServices = getServicesFromTags(tags);

  const handleServiceChange = (index: number, value: string) => {
    if (!discreteUpdate) return;

    // Récupérer les tags actuels sans les services
    const nonServiceTags = tags.filter(tag => tag.category !== 'services');

    // Créer la nouvelle liste de services
    const newServices = [...displayServices];
    newServices[index] = value;

    // Créer les nouveaux tags de services
    const newServiceTags = newServices
      .filter(Boolean)
      .map(service => {
        const existingServiceTag = servicesTags.find(tag => tag.value === service);
        return {
          id: existingServiceTag?.id || `services-${service}`,
          value: service,
          category: 'services' as const
        };
      });

    // Mettre à jour avec les nouveaux tags (action discrète = immédiat)
    discreteUpdate({
      tags: [...nonServiceTags, ...newServiceTags],
      // Garder services[] synchronisé pour l'instant (sera supprimé plus tard)
      services: newServices.filter(Boolean)
    });
  };

  // Cible NATINF : la saisie écrit infractionNatinfCodes (et non plus des tags).
  const setInfractionCodes = (codes: string[]) => {
    if (!discreteUpdate) return;
    discreteUpdate({ infractionNatinfCodes: Array.from(new Set(codes)) });
  };

  const suiviJIRS = tags.some(t => t.category === 'suivi' && t.value === 'JIRS');
  const suiviPG = tags.some(t => t.category === 'suivi' && t.value === 'PG');

  return (
    <div className="bg-gray-50 rounded-lg p-2 mb-4">
      {(suiviJIRS || suiviPG) && (
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-200">
          {suiviJIRS && (
            <Badge className="bg-blue-100 text-blue-800 border border-blue-300 gap-1">
              <Flag className="h-3 w-3" />
              Suivi JIRS
            </Badge>
          )}
          {suiviPG && (
            <Badge className="bg-purple-100 text-purple-800 border border-purple-300 gap-1">
              <Flag className="h-3 w-3" />
              Suivi Parquet Général
            </Badge>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <h3 className="text-xs font-medium text-gray-500">Date de début</h3>
          {isEditing ? (
            <Input
              type="date"
              value={dateDebut}
              onChange={(e) => discreteUpdate?.({ dateDebut: e.target.value })}
              className="h-7 text-sm"
            />
          ) : (
            <p className="text-sm">{new Date(dateDebut).toLocaleDateString()}</p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-medium text-gray-500">Service(s)</h3>
          {isEditing ? (
            <div className="space-y-1">
              <Select
                value={displayServices[0] || ''}
                onChange={(e) => handleServiceChange(0, e.target.value)}
                className="h-7 text-sm"
              >
                <option value="">Service principal</option>
                {servicesTags.map((service) => (
                  <option key={service.id} value={service.value}>
                    {service.value}
                  </option>
                ))}
              </Select>
              <Select
                value={displayServices[1] || ''}
                onChange={(e) => handleServiceChange(1, e.target.value)}
                className="h-7 text-sm"
              >
                <option value="">Service co-saisi</option>
                {servicesTags
                  .filter(service => service.value !== displayServices[0])
                  .map((service) => (
                    <option key={service.id} value={service.value}>
                      {service.value}
                    </option>
                  ))}
              </Select>
            </div>
          ) : (
            <p className="text-sm">{displayServices.join(' / ')}</p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-medium text-gray-500">Type d'infractions</h3>
          {isEditing ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">
                {infractionItems.map((inf, i) => (
                  <span key={inf.code || i} className="inline-flex items-center gap-1 text-sm bg-gray-100 rounded px-1.5 py-0.5">
                    {inf.label}
                    {inf.code && <NatinfBadge code={inf.code} nature={inf.nature} quantumLabel={inf.quantumLabel} compact />}
                    {inf.code && (
                      <button
                        type="button"
                        onClick={() => setInfractionCodes(currentCodes.filter(c => c !== inf.code))}
                        className="ml-0.5 text-gray-400 hover:text-red-600"
                        aria-label={`Retirer ${inf.label}`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <NatinfPicker
                onSelect={(entry) => setInfractionCodes([...currentCodes, entry.code])}
                placeholder="Ajouter une infraction (n° NATINF ou libellé)…"
              />
            </div>
          ) : infractionItems.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {infractionItems.map((inf, i) => (
                <span key={inf.code || i} className="inline-flex items-center gap-1 text-sm">
                  {inf.label}
                  {inf.code && <NatinfBadge code={inf.code} nature={inf.nature} quantumLabel={inf.quantumLabel} compact />}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">—</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-3">
        <div>
          <h3 className="text-xs font-medium text-gray-500">Directeur d'enquête</h3>
          {isEditing ? (
            <Input
              value={localDirecteur}
              onChange={(e) => {
                setLocalDirecteur(e.target.value);
                onUpdate?.({ directeurEnquete: e.target.value });
              }}
              className="h-7 text-sm"
              placeholder="Nom du directeur d'enquête"
            />
          ) : (
            <p className="text-sm">{directeurEnquete || <span className="text-gray-400 italic">—</span>}</p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-medium text-gray-500">Numéro parquet</h3>
          {isEditing ? (
            <Input
              value={localParquet}
              onChange={(e) => {
                setLocalParquet(e.target.value);
                onUpdate?.({ numeroParquet: e.target.value });
              }}
              className="h-7 text-sm"
              placeholder="Numéro de parquet"
            />
          ) : (
            <p className="text-sm">{numeroParquet || <span className="text-gray-400 italic">—</span>}</p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-medium text-gray-500">Numéro IDJ</h3>
          {isEditing ? (
            <Input
              value={localIDJ}
              onChange={(e) => {
                setLocalIDJ(e.target.value);
                onUpdate?.({ numeroIDJ: e.target.value });
              }}
              className="h-7 text-sm"
              placeholder="Identifiant Justice"
            />
          ) : (
            <p className="text-sm">{numeroIDJ || <span className="text-gray-400 italic">—</span>}</p>
          )}
        </div>
      </div>

      <div className="mt-2">
        <h3 className="text-xs font-medium text-gray-500">Description</h3>
        {isEditing ? (
          <textarea
            value={localDescription}
            onChange={(e) => {
              setLocalDescription(e.target.value);
              onUpdate?.({ description: e.target.value });
            }}
            className="w-full min-h-[60px] text-sm p-2 rounded border resize-none"
            placeholder="Description de l'enquête..."
          />
        ) : (
          description && <p className="text-sm whitespace-pre-wrap">{description}</p>
        )}
      </div>
    </div>
  );
});