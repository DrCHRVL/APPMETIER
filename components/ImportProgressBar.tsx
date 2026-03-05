import React, { useEffect, useState } from 'react';

interface ImportProgressBarProps {
  className?: string;
  value?: number;
  indeterminate?: boolean;
}

export const ImportProgressBar = ({ 
  className = '', 
  value = 0, 
  indeterminate = true 
}: ImportProgressBarProps) => {
  const [progress, setProgress] = useState(value);

  useEffect(() => {
    if (indeterminate) {
      const timer = setInterval(() => {
        setProgress((prev) => {
          const nextValue = prev + 5;
          if (nextValue > 100) {
            return 0;
          }
          return nextValue;
        });
      }, 100);

      return () => clearInterval(timer);
    } else {
      setProgress(value);
    }
  }, [indeterminate, value]);

  return (
    <div className={`w-full h-2 bg-gray-200 rounded-full ${className}`}>
      <div 
        className={`h-full rounded-full transition-all ease-in-out duration-300 ${
          indeterminate ? 'bg-blue-500' : 'bg-green-500'
        }`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};

export default ImportProgressBar;