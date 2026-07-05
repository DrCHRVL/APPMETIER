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

  // Tout le calcul (validation, progression, jours restants) vit dans l'effet :
  // aucun setState pendant le rendu. La couleur est dérivée du state `daysLeft`.
  useEffect(() => {
    const getError = (): string | null => {
      const debut = new Date(dateDebut);
      const fin = new Date(dateFin);
      const pose = datePose ? new Date(datePose) : null;
      if (isNaN(debut.getTime())) return "Date de début invalide";
      if (isNaN(fin.getTime())) return "Date de fin invalide";
      if (pose && isNaN(pose.getTime())) return "Date de pose invalide";
      if (datePose && pose && pose < debut) return "La date de pose ne peut pas être avant la date de début";
      if (datePose && pose && pose > fin) return "La date de pose ne peut pas être après la date de fin";
      return null;
    };

    const calcProgress = (): number => {
      if (!datePose) return 0;
      const start = new Date(datePose).getTime();
      const end = new Date(dateFin).getTime();
      const now = Date.now();
      if (now < start) return 0;
      if (now > end) return 100;
      return Math.round(((now - start) / (end - start)) * 100);
    };

    const calcDaysLeft = (): number => {
      const end = new Date(dateFin).getTime();
      const now = Date.now();
      if (now > end) return -999; // Valeur spéciale pour indiquer "terminé"
      if (!datePose) return -1;
      return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    };

    const update = () => {
      const err = getError();
      setError(err);
      if (err) { setProgress(0); setDaysLeft(0); return; }
      setProgress(calcProgress());
      setDaysLeft(calcDaysLeft());
    };

    update();

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const timeUntilMidnight = tomorrow.getTime() - now.getTime();

    let interval: ReturnType<typeof setInterval> | undefined;
    const initialTimeout = setTimeout(() => {
      update();
      interval = setInterval(update, 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);

    return () => {
      clearTimeout(initialTimeout);
      if (interval) clearInterval(interval);
    };
  }, [dateDebut, dateFin, datePose]);

  const getProgressColor = () => {
    if (daysLeft === -999) return "bg-gray-400"; // Terminé
    if (daysLeft <= 2) return "bg-red-500";
    if (daysLeft <= 7) return "bg-yellow-500";
    return "bg-blue-500";
  };

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
