import { Progress } from "./ui/progress"
import { useEffect, useState } from "react";

interface ProgressBarProps {
  dateDebut: string;
  dateFin: string;
  datePose?: string | null;
}

const ProgressBar = ({ dateDebut, dateFin, datePose = null }: ProgressBarProps) => {
  const [progress, setProgress] = useState(0);
  const [daysLeft, setDaysLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const validateDates = () => {
    try {
      const debut = new Date(dateDebut);
      const fin = new Date(dateFin);
      const pose = datePose ? new Date(datePose) : null;

      if (isNaN(debut.getTime())) throw new Error("Date de début invalide");
      if (isNaN(fin.getTime())) throw new Error("Date de fin invalide");
      if (pose && isNaN(pose.getTime())) throw new Error("Date de pose invalide");

      if (datePose) {
        if (pose && pose < debut) throw new Error("La date de pose ne peut pas être avant la date de début");
        if (pose && pose > fin) throw new Error("La date de pose ne peut pas être après la date de fin");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de validation des dates");
      return false;
    }
  };

  const calculateProgress = () => {
    if (!validateDates() || !datePose) return 0;

    const start = new Date(datePose).getTime();
    const end = new Date(dateFin).getTime();
    const now = new Date().getTime();
    
    if (now < start) return 0;
    if (now > end) return 100;
    
    const totalDuration = end - start;
    const elapsed = now - start;
    return Math.round((elapsed / totalDuration) * 100);
  };

  const calculateDaysLeft = () => {
    if (!validateDates()) return -1;

    const end = new Date(dateFin).getTime();
    const now = new Date().getTime();
    
    // Si la date de fin est dépassée
    if (now > end) return -999; // Valeur spéciale pour indiquer "terminé"
    if (!datePose) return -1;
    
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  };

  const getProgressColor = () => {
    const days = calculateDaysLeft();
    if (days === -999) return "bg-gray-400"; // Terminé
    if (days <= 2) return "bg-red-500";
    if (days <= 7) return "bg-yellow-500";
    return "bg-blue-500";
  };

  useEffect(() => {
    const updateProgress = () => {
      setProgress(calculateProgress());
      setDaysLeft(calculateDaysLeft());
    };

    updateProgress();
    setError(null);

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const timeUntilMidnight = tomorrow.getTime() - now.getTime();

    const initialTimeout = setTimeout(() => {
      updateProgress();
      const interval = setInterval(updateProgress, 24 * 60 * 60 * 1000);
      return () => clearInterval(interval);
    }, timeUntilMidnight);

    return () => clearTimeout(initialTimeout);
  }, [dateDebut, dateFin, datePose]);

  if (error) {
    return <div className="text-red-500 text-sm">{error}</div>;
  }

  return (
    <div className="w-full space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>Progression: {progress}%</span>
        <span>
          {datePose ? (
            daysLeft >= 0 
              ? `${daysLeft} jours restants` 
              : daysLeft === -999 
                ? "Terminé" 
                : "En attente de pose..."
          ) : (
            "En attente de pose..."
          )}
        </span>
      </div>
      <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
        <div 
          className={`h-full transition-all duration-300 ${getProgressColor()}`}
          style={{ width: `${progress}%` }}
          title={`Date de fin: ${new Date(dateFin).toLocaleDateString()}`}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>Autorisation: {new Date(dateDebut).toLocaleDateString()}</span>
        <span>Pose: {datePose ? new Date(datePose).toLocaleDateString() : "???"}</span>
      </div>
    </div>
  );
};

export default ProgressBar;