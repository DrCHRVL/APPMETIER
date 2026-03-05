import React from 'react';
import { FileText, Plus, Archive, Timer, Tags, Bell, Save, BarChart, Activity, Scale } from 'lucide-react';

import { Button } from './ui/button';
import { AlertBadge } from './AlertBadge';

interface SideBarProps {
  isOpen: boolean;
  currentView: string;
  onViewChange: (view: string) => void;
  onNewEnquete: () => void;
  alertCount: number;
}

export const SideBar = ({ 
  isOpen, 
  currentView, 
  onViewChange, 
  onNewEnquete,
  alertCount
}: SideBarProps) => {
  const sidebarWidth = isOpen ? 'w-64' : 'w-16';

  return (
    <div className={`${sidebarWidth} h-screen bg-[#2B5746] shadow-lg transition-all flex flex-col relative`}>
      <div className="p-4 flex flex-col space-y-4">
        <div className="relative">
          <Button 
            className={`w-full flex items-center justify-start text-white ${currentView === 'enquetes' ? 'bg-[#47725f] hover:bg-[#47725f]/90' : 'hover:bg-white/10'}`}
            variant="ghost"
            onClick={() => onViewChange('enquetes')}
          >
            <FileText className="h-4 w-4 mr-2" />
            {isOpen && "Enquêtes préliminaires"}
          </Button>
          {alertCount > 0 && currentView === 'enquetes' && <AlertBadge count={alertCount} />}
        </div>

        {/* Instructions judiciaires */}
        <div className="relative">
          <Button 
            className={`w-full flex items-center justify-start text-white ${currentView === 'instructions' ? 'bg-[#47725f] hover:bg-[#47725f]/90' : 'hover:bg-white/10'}`}
            variant="ghost"
            onClick={() => onViewChange('instructions')}
          >
            <Scale className="h-4 w-4 mr-2" />
            {isOpen && "Instructions judiciaires"}
          </Button>
          {alertCount > 0 && currentView === 'instructions' && <AlertBadge count={alertCount} />}
        </div>

        <Button 
          className={`w-full flex items-center justify-start text-white ${currentView === 'archives' ? 'bg-[#47725f] hover:bg-[#47725f]/90' : 'hover:bg-white/10'}`}
          variant="ghost"
          onClick={() => onViewChange('archives')}
        >
          <Archive className="h-4 w-4 mr-2" />
          {isOpen && "Enquêtes terminées"}
        </Button>
        

        <Button 
          className={`w-full flex items-center justify-start text-white ${currentView === 'air' ? 'bg-[#47725f] hover:bg-[#47725f]/90' : 'hover:bg-white/10'}`}
          variant="ghost"
          onClick={() => onViewChange('air')}
        >
          <Activity className="h-4 w-4 mr-2" />
          {isOpen && "Suivi AIR"}
        </Button>
        
        <Button 
          className={`w-full flex items-center justify-start text-white ${currentView === 'tags' ? 'bg-[#47725f] hover:bg-[#47725f]/90' : 'hover:bg-white/10'}`}
          variant="ghost"
          onClick={() => onViewChange('tags')}
        >
          <Tags className="h-4 w-4 mr-2" />
          {isOpen && "Tags"}
        </Button>

        <Button 
          className={`w-full flex items-center justify-start text-white ${currentView === 'alertes' ? 'bg-[#47725f] hover:bg-[#47725f]/90' : 'hover:bg-white/10'}`}
          variant="ghost"
          onClick={() => onViewChange('alertes')}
        >
          <Bell className="h-4 w-4 mr-2" />
          {isOpen && "Alertes"}
        </Button>

        <Button 
          className={`w-full flex items-center justify-start text-white ${currentView === 'statistiques' ? 'bg-[#47725f] hover:bg-[#47725f]/90' : 'hover:bg-white/10'}`}
          variant="ghost"
          onClick={() => onViewChange('statistiques')}
        >
          <BarChart className="h-4 w-4 mr-2" />
          {isOpen && "Statistiques"}
        </Button>

        <Button 
          className={`w-full flex items-center justify-start text-white ${currentView === 'sauvegardes' ? 'bg-[#47725f] hover:bg-[#47725f]/90' : 'hover:bg-white/10'}`}
          variant="ghost"
          onClick={() => onViewChange('sauvegardes')}
        >
          <Save className="h-4 w-4 mr-2" />
          {isOpen && "Sauvegardes"}
        </Button>

        <Button 
          className="w-full flex items-center justify-start bg-[#1B3D2D] hover:bg-[#1B3D2D]/90 text-white"
          onClick={onNewEnquete}
        >
          <Plus className="h-4 w-4 mr-2" />
          {isOpen && (currentView === 'instructions' ? "Nouveau dossier" : "Nouvelle enquête")}
        </Button>
      </div>

      <div className="copyright">
        Propriété de Audran CHEVALIER, Parquet d'AMIENS
      </div>
    </div>
  );
};