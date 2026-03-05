import { DocumentEnquete } from './types';
import { SERVER_CONFIG } from '../config/serverConfig';
import fs from 'fs';
import path from 'path';

class DocumentManager {
  private getEnquetePath(enqueteId: number): string {
    return path.join(SERVER_CONFIG.documentBasePath, `Enquete_${enqueteId}`);
  }

  async uploadDocument(
    file: File,
    enqueteId: number,
    category: string
  ): Promise<DocumentEnquete> {
    try {
      const enquetePath = this.getEnquetePath(enqueteId);
      const categoryPath = path.join(enquetePath, category);
      
      // Créer les dossiers s'ils n'existent pas
      if (!fs.existsSync(enquetePath)) {
        fs.mkdirSync(enquetePath, { recursive: true });
      }
      if (!fs.existsSync(categoryPath)) {
        fs.mkdirSync(categoryPath);
      }

      const filePath = path.join(categoryPath, file.name);
      
      // Écrire le fichier
      const buffer = await file.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(buffer));

      return {
        id: Date.now(),
        nom: file.name,
        type: file.type,
        dateCreation: new Date().toISOString(),
        dateModification: new Date().toISOString(),
        taille: file.size,
        cheminComplet: filePath,
        categorie: category
      };
    } catch (error) {
      console.error('Erreur upload:', error);
      throw error;
    }
  }

  async getDocumentUrl(doc: DocumentEnquete): Promise<string> {
    // Retourner le chemin complet du fichier
    return doc.cheminComplet;
  }

  async deleteDocument(doc: DocumentEnquete): Promise<void> {
    try {
      if (fs.existsSync(doc.cheminComplet)) {
        fs.unlinkSync(doc.cheminComplet);
      }
    } catch (error) {
      console.error('Erreur suppression:', error);
      throw error;
    }
  }

  async listDocuments(enqueteId: number, category: string): Promise<DocumentEnquete[]> {
    try {
      const categoryPath = path.join(this.getEnquetePath(enqueteId), category);
      
      if (!fs.existsSync(categoryPath)) {
        return [];
      }

      const files = fs.readdirSync(categoryPath);
      return files.map(fileName => {
        const filePath = path.join(categoryPath, fileName);
        const stats = fs.statSync(filePath);
        
        return {
          id: Date.now() + Math.random(),
          nom: fileName,
          type: path.extname(fileName),
          dateCreation: stats.birthtime.toISOString(),
          dateModification: stats.mtime.toISOString(),
          taille: stats.size,
          cheminComplet: filePath,
          categorie: category
        };
      });
    } catch (error) {
      console.error('Erreur listage documents:', error);
      return [];
    }
  }
}

export const documentManager = new DocumentManager();