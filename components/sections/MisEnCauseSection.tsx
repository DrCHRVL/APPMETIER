import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Edit, X, FileText } from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { Dialog, DialogContent } from '../ui/dialog';

interface MisEnCauseSectionProps {
  enquete: Enquete;
  onUpdate?: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
}

export const MisEnCauseSection = ({ enquete, onUpdate, isEditing }: MisEnCauseSectionProps) => {
  const [editingMecId, setEditingMecId] = useState<number | null>(null);
  const [newMecData, setNewMecData] = useState({ nom: '', role: '', fichierCasier: '' });
  const [editingData, setEditingData] = useState({ nom: '', role: '', fichierCasier: '' });
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [currentPdfPath, setCurrentPdfPath] = useState<string | null>(null);

  const handleAddMec = () => {
    if (!onUpdate || !newMecData.nom.trim()) return;

    const newMec = {
      id: Date.now(),
      nom: newMecData.nom.trim(),
      role: newMecData.role.trim(),
      fichierCasier: newMecData.fichierCasier.trim(),
      statut: 'actif'
    };

    onUpdate(enquete.id, {
      misEnCause: [...enquete.misEnCause, newMec]
    });

    setNewMecData({ nom: '', role: '', fichierCasier: '' });
  };

  const handleUpdateMec = (id: number) => {
    if (!onUpdate || !editingData.nom.trim()) return;

    const updatedMecs = enquete.misEnCause.map(mec => 
      mec.id === id ? { 
        ...mec, 
        nom: editingData.nom.trim(),
        role: editingData.role.trim(),
        fichierCasier: editingData.fichierCasier.trim()
      } : mec
    );

    onUpdate(enquete.id, { misEnCause: updatedMecs });
    setEditingMecId(null);
    setEditingData({ nom: '', role: '', fichierCasier: '' });
  };

  const handleDeleteMec = (id: number) => {
    if (!onUpdate) return;
    const updatedMecs = enquete.misEnCause.filter(mec => mec.id !== id);
    onUpdate(enquete.id, { misEnCause: updatedMecs });
  };

  const handleBrowsePdf = async (id: number) => {
    try {
      // Utiliser l'API Electron pour ouvrir le sélecteur de fichiers
      const filePath = await window.electronAPI.openFileDialog({
        title: 'Sélectionner un fichier PDF de casier judiciaire (B1)',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['openFile']
      });
      
      if (!filePath) return;
      
      // Copier le fichier dans le dossier de stockage des casiers
      const fileName = `casier_${enquete.numero}_${Date.now()}.pdf`;
      const savedPath = await window.electronAPI.saveCasierFile(filePath, fileName);
      
      if (savedPath) {
        if (id === editingMecId) {
          setEditingData(prev => ({ ...prev, fichierCasier: savedPath }));
        } else {
          // Pour un nouveau mis en cause
          setNewMecData(prev => ({ ...prev, fichierCasier: savedPath }));
        }
      }
    } catch (error) {
      console.error('Erreur lors de la sélection du fichier:', error);
    }
  };

  const openPdfPreview = (pdfPath: string) => {
    if (!pdfPath) return;
    setCurrentPdfPath(pdfPath);
    setPdfPreviewOpen(true);
  };
  
  const handleRemoveCasier = (id: number) => {
    if (!onUpdate) return;
    
    const mecToUpdate = enquete.misEnCause.find(mec => mec.id === id);
    if (!mecToUpdate || !mecToUpdate.fichierCasier) return;
    
    // Supprimer le fichier physique
    window.electronAPI.deleteCasierFile(mecToUpdate.fichierCasier)
      .then((success) => {
        if (success) {
          // Mettre à jour le mis en cause sans le casier
          const updatedMecs = enquete.misEnCause.map(mec => 
            mec.id === id ? { ...mec, fichierCasier: '' } : mec
          );
          onUpdate(enquete.id, { misEnCause: updatedMecs });
        }
      })
      .catch(error => {
        console.error('Erreur lors de la suppression du casier:', error);
      });
  };

  return (
    <>
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="text-sm font-semibold mb-2">Mis en cause</h3>
        
        {isEditing && (
          <div className="space-y-2 mb-4">
            <Input
              placeholder="Nom du mis en cause"
              value={newMecData.nom}
              onChange={(e) => setNewMecData(prev => ({ ...prev, nom: e.target.value }))}
              className="text-sm"
            />
            <Input
              placeholder="Rôle dans l'affaire"
              value={newMecData.role}
              onChange={(e) => setNewMecData(prev => ({ ...prev, role: e.target.value }))}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Input
                placeholder="Casier judiciaire (B1)"
                value={newMecData.fichierCasier ? 'B1 importé' : 'Aucun casier'}
                className="text-sm flex-1"
                readOnly
              />
              <Button 
                onClick={() => handleBrowsePdf(-1)} 
                size="sm" 
                variant="outline"
              >
                Importer
              </Button>
              {newMecData.fichierCasier && (
                <Button 
                  onClick={() => setNewMecData(prev => ({ ...prev, fichierCasier: '' }))} 
                  size="sm" 
                  variant="destructive"
                >
                  Retirer
                </Button>
              )}
            </div>
            <Button onClick={handleAddMec} size="sm" className="w-full">
              Ajouter
            </Button>
          </div>
        )}

        <div className="grid gap-2">
          {enquete.misEnCause.map((mec) => (
            <div key={mec.id} className="bg-white p-2 rounded shadow-sm">
              {editingMecId === mec.id ? (
                <div className="space-y-2">
                  <Input
                    value={editingData.nom}
                    onChange={(e) => setEditingData(prev => ({ ...prev, nom: e.target.value }))}
                    className="text-sm"
                    placeholder="Nom"
                  />
                  <Input
                    value={editingData.role}
                    onChange={(e) => setEditingData(prev => ({ ...prev, role: e.target.value }))}
                    className="text-sm"
                    placeholder="Rôle"
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="Casier judiciaire (B1)"
                      value={editingData.fichierCasier ? 'B1 importé' : 'Aucun casier'}
                      className="text-sm flex-1"
                      readOnly
                    />
                    <Button 
                      onClick={() => handleBrowsePdf(mec.id)} 
                      size="sm" 
                      variant="outline"
                    >
                      Importer
                    </Button>
                    {editingData.fichierCasier && (
                      <Button 
                        onClick={() => setEditingData(prev => ({ ...prev, fichierCasier: '' }))} 
                        size="sm" 
                        variant="destructive"
                      >
                        Retirer
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm"
                      className="flex-1"
                      onClick={() => handleUpdateMec(mec.id)}
                    >
                      Valider
                    </Button>
                    <Button 
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingMecId(null);
                        setEditingData({ nom: '', role: '', fichierCasier: '' });
                      }}
                    >
                      Annuler
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-start">
                  <div>
                    <div 
                      className={`font-medium text-sm flex items-center gap-1 ${mec.fichierCasier ? 'cursor-pointer hover:text-blue-600' : ''}`}
                      onClick={() => mec.fichierCasier && openPdfPreview(mec.fichierCasier)}
                    >
                      {mec.nom}
                      {mec.fichierCasier && <FileText className="h-3 w-3 text-blue-500" title="Casier judiciaire B1 disponible" />}
                    </div>
                    {mec.role && (
                      <div className="text-xs text-gray-500">{mec.role}</div>
                    )}
                  </div>
                  {isEditing && (
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => {
                          setEditingMecId(mec.id);
                          setEditingData({ 
                            nom: mec.nom,
                            role: mec.role || '',
                            fichierCasier: mec.fichierCasier || ''
                          });
                        }}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      {mec.fichierCasier && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleRemoveCasier(mec.id)}
                          className="text-red-500"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleDeleteMec(mec.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Fenêtre modale pour afficher le PDF */}
      <Dialog open={pdfPreviewOpen} onOpenChange={(open) => setPdfPreviewOpen(open)}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          {currentPdfPath && (
            <div className="w-full h-[80vh]">
              <webview 
                src={`file://${currentPdfPath}`}
                style={{width: '100%', height: '100%'}}
                plugins="true"
              />
              <div className="mt-2 flex justify-between">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setPdfPreviewOpen(false)}
                >
                  Fermer
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => window.electronAPI.openExternalFile(currentPdfPath)}
                >
                  Ouvrir en externe
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};