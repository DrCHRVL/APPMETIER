import React from 'react';

interface CheckboxGroupProps {
  children: React.ReactNode;
  className?: string;
}

export const CheckboxGroup: React.FC<CheckboxGroupProps> = ({ children, className = '' }) => {
  return <div className={`flex flex-wrap gap-2 ${className}`}>{children}</div>;
};

interface CheckboxItemProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export const CheckboxItem: React.FC<CheckboxItemProps> = ({
  id,
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
}) => {
  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="scale-75"
      />
      <label htmlFor={id} className="text-xs">
        {label}
      </label>
    </div>
  );
};