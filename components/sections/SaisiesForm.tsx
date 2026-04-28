import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Confiscations,
  TypeVehicule,
  TypeImmeuble,
  CategorieObjet,
  TypeStupefiant,
} from '@/types/audienceTypes';

interface SaisiesFormProps {
  saisies: Confiscations;
  onChange: (updater: (prev: Confiscations) => Confiscations) => void;
}

/**
 * Formulaire détaillé d'édition des saisies (véhicules, immeubles, avoirs financiers,
 * objets mobiliers, stupéfiants). Réutilisé dans :
 *  - ArchiveEnqueteModal (au moment de l'archivage)
 *  - EditPendingAudienceModal (audience en attente)
 *  - SaisiesSection (détail enquête, en cours d'enquête)
 *
 * La donnée est la même partout : un objet `Confiscations` stocké dans
 * `ResultatAudience.saisies`. Pas de duplication de stockage.
 */
export const SaisiesForm = ({ saisies, onChange }: SaisiesFormProps) => {
  return (
    <>
      {/* Véhicules */}
      <details className="mb-3 border rounded-lg">
        <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
          <span>Véhicules ({saisies.vehicules.length})</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              onChange((prev) => ({
                ...prev,
                vehicules: [...prev.vehicules, { type: 'voiture' as TypeVehicule }],
              }));
            }}
          >
            + Ajouter
          </Button>
        </summary>
        <div className="p-2 space-y-2">
          {saisies.vehicules.map((v, i) => (
            <div key={i} className="grid grid-cols-4 gap-1 items-end bg-gray-50 p-2 rounded text-sm">
              <div>
                <Label className="text-xs">Type</Label>
                <select
                  className="w-full p-1.5 border rounded text-sm"
                  value={v.type}
                  onChange={(e) => {
                    const value = e.target.value as TypeVehicule;
                    onChange((prev) => {
                      const arr = [...prev.vehicules];
                      arr[i] = { ...arr[i], type: value };
                      return { ...prev, vehicules: arr };
                    });
                  }}
                >
                  <option value="voiture">Voiture</option>
                  <option value="moto">Moto</option>
                  <option value="scooter">Scooter</option>
                  <option value="utilitaire">Utilitaire</option>
                  <option value="poids_lourd">Poids lourd</option>
                  <option value="bateau">Bateau</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Marque</Label>
                <Input
                  className="text-sm"
                  value={v.marqueModele || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange((prev) => {
                      const arr = [...prev.vehicules];
                      arr[i] = { ...arr[i], marqueModele: value };
                      return { ...prev, vehicules: arr };
                    });
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Immatriculation</Label>
                <Input
                  className="text-sm"
                  value={v.immatriculation || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange((prev) => {
                      const arr = [...prev.vehicules];
                      arr[i] = { ...arr[i], immatriculation: value };
                      return { ...prev, vehicules: arr };
                    });
                  }}
                />
              </div>
              <div className="flex gap-1 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Valeur (€)</Label>
                  <Input
                    className="text-sm"
                    type="number"
                    min="0"
                    value={v.valeurEstimee || ''}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || undefined;
                      onChange((prev) => {
                        const arr = [...prev.vehicules];
                        arr[i] = { ...arr[i], valeurEstimee: value };
                        return { ...prev, vehicules: arr };
                      });
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      vehicules: prev.vehicules.filter((_, j) => j !== i),
                    }))
                  }
                >
                  ×
                </Button>
              </div>
            </div>
          ))}
          {saisies.vehicules.length === 0 && (
            <p className="text-xs text-gray-400">Aucun véhicule saisi</p>
          )}
        </div>
      </details>

      {/* Immeubles */}
      <details className="mb-3 border rounded-lg">
        <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
          <span>Immeubles ({saisies.immeubles.length})</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              onChange((prev) => ({
                ...prev,
                immeubles: [...prev.immeubles, { type: 'appartement' as TypeImmeuble }],
              }));
            }}
          >
            + Ajouter
          </Button>
        </summary>
        <div className="p-2 space-y-2">
          {saisies.immeubles.map((im, i) => (
            <div key={i} className="grid grid-cols-3 gap-1 items-end bg-gray-50 p-2 rounded text-sm">
              <div>
                <Label className="text-xs">Type</Label>
                <select
                  className="w-full p-1.5 border rounded text-sm"
                  value={im.type}
                  onChange={(e) => {
                    const value = e.target.value as TypeImmeuble;
                    onChange((prev) => {
                      const arr = [...prev.immeubles];
                      arr[i] = { ...arr[i], type: value };
                      return { ...prev, immeubles: arr };
                    });
                  }}
                >
                  <option value="appartement">Appartement</option>
                  <option value="maison">Maison</option>
                  <option value="terrain">Terrain</option>
                  <option value="local_commercial">Local commercial</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Adresse</Label>
                <Input
                  className="text-sm"
                  value={im.adresse || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange((prev) => {
                      const arr = [...prev.immeubles];
                      arr[i] = { ...arr[i], adresse: value };
                      return { ...prev, immeubles: arr };
                    });
                  }}
                />
              </div>
              <div className="flex gap-1 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Valeur (€)</Label>
                  <Input
                    className="text-sm"
                    type="number"
                    min="0"
                    value={im.valeurEstimee || ''}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || undefined;
                      onChange((prev) => {
                        const arr = [...prev.immeubles];
                        arr[i] = { ...arr[i], valeurEstimee: value };
                        return { ...prev, immeubles: arr };
                      });
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      immeubles: prev.immeubles.filter((_, j) => j !== i),
                    }))
                  }
                >
                  ×
                </Button>
              </div>
            </div>
          ))}
          {saisies.immeubles.length === 0 && (
            <p className="text-xs text-gray-400">Aucun immeuble saisi</p>
          )}
        </div>
      </details>

      {/* Avoirs financiers */}
      <details className="mb-3 border rounded-lg">
        <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg">
          Avoirs financiers
        </summary>
        <div className="p-2 space-y-3">
          <div>
            <Label className="text-xs">Numéraire (espèces) (€)</Label>
            <Input
              type="number"
              min="0"
              className="text-sm"
              value={saisies.numeraire || ''}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 0;
                onChange((prev) => ({ ...prev, numeraire: value }));
              }}
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <Label className="text-xs">Saisies bancaires</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange((prev) => ({
                    ...prev,
                    saisiesBancaires: [...prev.saisiesBancaires, { montant: 0 }],
                  }))
                }
              >
                + Ajouter
              </Button>
            </div>
            {saisies.saisiesBancaires.map((sb, i) => (
              <div key={i} className="grid grid-cols-3 gap-1 items-end mb-1 bg-gray-50 p-2 rounded text-sm">
                <div>
                  <Label className="text-xs">Montant (€)</Label>
                  <Input
                    className="text-sm"
                    type="number"
                    min="0"
                    value={sb.montant || ''}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 0;
                      onChange((prev) => {
                        const arr = [...prev.saisiesBancaires];
                        arr[i] = { ...arr[i], montant: value };
                        return { ...prev, saisiesBancaires: arr };
                      });
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs">Banque</Label>
                  <Input
                    className="text-sm"
                    value={sb.banque || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      onChange((prev) => {
                        const arr = [...prev.saisiesBancaires];
                        arr[i] = { ...arr[i], banque: value };
                        return { ...prev, saisiesBancaires: arr };
                      });
                    }}
                  />
                </div>
                <div className="flex gap-1 items-end">
                  <div className="flex-1">
                    <Label className="text-xs">Réf. AGRASC</Label>
                    <Input
                      className="text-sm"
                      value={sb.referenceAgrasc || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        onChange((prev) => {
                          const arr = [...prev.saisiesBancaires];
                          arr[i] = { ...arr[i], referenceAgrasc: value };
                          return { ...prev, saisiesBancaires: arr };
                        });
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        saisiesBancaires: prev.saisiesBancaires.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <Label className="text-xs">Cryptomonnaies</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange((prev) => ({
                    ...prev,
                    cryptomonnaies: [...prev.cryptomonnaies, { montantEur: 0 }],
                  }))
                }
              >
                + Ajouter
              </Button>
            </div>
            {saisies.cryptomonnaies.map((cr, i) => (
              <div key={i} className="grid grid-cols-2 gap-1 items-end mb-1 bg-gray-50 p-2 rounded text-sm">
                <div>
                  <Label className="text-xs">Valeur (€)</Label>
                  <Input
                    className="text-sm"
                    type="number"
                    min="0"
                    value={cr.montantEur || ''}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 0;
                      onChange((prev) => {
                        const arr = [...prev.cryptomonnaies];
                        arr[i] = { ...arr[i], montantEur: value };
                        return { ...prev, cryptomonnaies: arr };
                      });
                    }}
                  />
                </div>
                <div className="flex gap-1 items-end">
                  <div className="flex-1">
                    <Label className="text-xs">Type</Label>
                    <Input
                      className="text-sm"
                      placeholder="BTC, ETH..."
                      value={cr.typeCrypto || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        onChange((prev) => {
                          const arr = [...prev.cryptomonnaies];
                          arr[i] = { ...arr[i], typeCrypto: value };
                          return { ...prev, cryptomonnaies: arr };
                        });
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        cryptomonnaies: prev.cryptomonnaies.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>

      {/* Objets mobiliers */}
      <details className="mb-3 border rounded-lg">
        <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
          <span>Objets mobiliers ({saisies.objetsMobiliers.length})</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              onChange((prev) => ({
                ...prev,
                objetsMobiliers: [
                  ...prev.objetsMobiliers,
                  { categorie: 'electronique' as CategorieObjet, quantite: 1 },
                ],
              }));
            }}
          >
            + Ajouter
          </Button>
        </summary>
        <div className="p-2 space-y-2">
          {saisies.objetsMobiliers.map((obj, i) => (
            <div key={i} className="grid grid-cols-4 gap-1 items-end bg-gray-50 p-2 rounded text-sm">
              <div>
                <Label className="text-xs">Catégorie</Label>
                <select
                  className="w-full p-1.5 border rounded text-sm"
                  value={obj.categorie}
                  onChange={(e) => {
                    const value = e.target.value as CategorieObjet;
                    onChange((prev) => {
                      const arr = [...prev.objetsMobiliers];
                      arr[i] = { ...arr[i], categorie: value };
                      return { ...prev, objetsMobiliers: arr };
                    });
                  }}
                >
                  <option value="electronique">Électronique</option>
                  <option value="luxe">Luxe</option>
                  <option value="transport_leger">Transport léger</option>
                  <option value="informatique">Informatique</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input
                  className="text-sm"
                  value={obj.description || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange((prev) => {
                      const arr = [...prev.objetsMobiliers];
                      arr[i] = { ...arr[i], description: value };
                      return { ...prev, objetsMobiliers: arr };
                    });
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Quantité</Label>
                <Input
                  className="text-sm"
                  type="number"
                  min="1"
                  value={obj.quantite}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 1;
                    onChange((prev) => {
                      const arr = [...prev.objetsMobiliers];
                      arr[i] = { ...arr[i], quantite: value };
                      return { ...prev, objetsMobiliers: arr };
                    });
                  }}
                />
              </div>
              <div className="flex gap-1 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Valeur (€)</Label>
                  <Input
                    className="text-sm"
                    type="number"
                    min="0"
                    value={obj.valeurEstimee || ''}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || undefined;
                      onChange((prev) => {
                        const arr = [...prev.objetsMobiliers];
                        arr[i] = { ...arr[i], valeurEstimee: value };
                        return { ...prev, objetsMobiliers: arr };
                      });
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      objetsMobiliers: prev.objetsMobiliers.filter((_, j) => j !== i),
                    }))
                  }
                >
                  ×
                </Button>
              </div>
            </div>
          ))}
          {saisies.objetsMobiliers.length === 0 && (
            <p className="text-xs text-gray-400">Aucun objet</p>
          )}
        </div>
      </details>

      {/* Stupéfiants */}
      <details className="mb-3 border rounded-lg">
        <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg">
          Stupéfiants {saisies.stupefiants?.types?.length ? `(${saisies.stupefiants.types.length} type(s))` : ''}
        </summary>
        <div className="p-2 space-y-2">
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ['cocaine', 'Cocaïne'],
                ['heroine', 'Héroïne'],
                ['cannabis', 'Cannabis'],
                ['synthese', 'Drogues de synthèse'],
                ['autre', 'Autre'],
              ] as [TypeStupefiant, string][]
            ).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={saisies.stupefiants?.types?.includes(val) || false}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onChange((prev) => {
                      const current = prev.stupefiants?.types || [];
                      const newTypes = checked
                        ? [...current, val]
                        : current.filter((t) => t !== val);
                      return {
                        ...prev,
                        stupefiants:
                          newTypes.length > 0
                            ? {
                                ...prev.stupefiants,
                                types: newTypes,
                                quantite: prev.stupefiants?.quantite,
                                description: prev.stupefiants?.description,
                              }
                            : undefined,
                      };
                    });
                  }}
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
          {saisies.stupefiants?.types?.length ? (
            <div className="grid grid-cols-2 gap-1 mt-1">
              <div>
                <Label className="text-xs">Quantité</Label>
                <Input
                  className="text-sm"
                  placeholder="Ex: 5 kg"
                  value={saisies.stupefiants?.quantite || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange((prev) => ({
                      ...prev,
                      stupefiants: { ...prev.stupefiants!, quantite: value },
                    }));
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input
                  className="text-sm"
                  placeholder="Détails..."
                  value={saisies.stupefiants?.description || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange((prev) => ({
                      ...prev,
                      stupefiants: { ...prev.stupefiants!, description: value },
                    }));
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </>
  );
};
