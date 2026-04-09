import React from 'react';
import { Tag } from '@/types/interfaces';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { MultiSelect } from '../ui/multi-select';
import { Badge } from '../ui/badge';
import { Flag } from 'lucide-react';
import { useTags } from '@/hooks/useTags';

interface EnqueteHeaderProps {
  numero: string;
  dateDebut: string;
  services: string[];
  tags: Tag[];
  description?: string;
  directeurEnquete?: string;
  numeroParquet?: string;
  isEditing?: boolean;
  onUpdate?: (updates: Partial<any>) => void;
}

export const EnqueteHeader = React.memo(({
  numero,
  dateDebut,
  services,
  tags,
  description,
  directeurEnquete,
  numeroParquet,
  isEditing = false,
  onUpdate
}: EnqueteHeaderProps) => {
  const { getTagsByCategory, getServicesFromTags } = useTags();
  const servicesTags = getTagsByCategory('services');
  const infractionsTags = getTagsByCategory('infractions');
  const infractionTags = tags.filter(tag => tag.category === 'infractions');

  // Services dérivés depuis les tags au lieu d'utiliser props.services
  const displayServices = getServicesFromTags(tags);

  const handleServiceChange = (index: number, value: string) => {
    if (!onUpdate) return;
    
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
    
    // Mettre à jour avec les nouveaux tags
    onUpdate({ 
      tags: [...nonServiceTags, ...newServiceTags],
      // Garder services[] synchronisé pour l'instant (sera supprimé plus tard)
      services: newServices.filter(Boolean)
    });
  };

  const handleInfractionChange = (selectedValues: string[]) => {
    if (!onUpdate) return;
    const selectedTags = selectedValues.map(value => ({
      id: `infractions-${value}`,
      value,
      category: 'infractions' as const
    }));
    const serviceTags = tags.filter(tag => tag.category === 'services');
    onUpdate({ tags: [...serviceTags, ...selectedTags] });
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
              onChange={(e) => onUpdate?.({ dateDebut: e.target.value })}
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
            <MultiSelect
              options={infractionsTags}
              value={infractionTags.map(tag => tag.value)}
              onChange={handleInfractionChange}
              className="text-sm"
            />
          ) : (
            <p className="text-sm">{infractionTags.map(tag => tag.value).join(', ')}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-3">
        <div>
          <h3 className="text-xs font-medium text-gray-500">Directeur d'enquête</h3>
          {isEditing ? (
            <Input
              value={directeurEnquete || ''}
              onChange={(e) => onUpdate?.({ directeurEnquete: e.target.value })}
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
              value={numeroParquet || ''}
              onChange={(e) => onUpdate?.({ numeroParquet: e.target.value })}
              className="h-7 text-sm"
              placeholder="Numéro de parquet"
            />
          ) : (
            <p className="text-sm">{numeroParquet || <span className="text-gray-400 italic">—</span>}</p>
          )}
        </div>
      </div>

      <div className="mt-2">
        <h3 className="text-xs font-medium text-gray-500">Description</h3>
        {isEditing ? (
          <textarea
            value={description}
            onChange={(e) => onUpdate?.({ description: e.target.value })}
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