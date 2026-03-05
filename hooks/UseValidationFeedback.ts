import { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/contexts/ToastContext';

interface ValidationConfig {
  showToasts?: boolean;
  debounceMs?: number;
  autoValidate?: boolean;
}

interface FieldValidation {
  isValid: boolean;
  error?: string;
  warning?: string;
  success?: string;
}

export const useValidationFeedback = (config: ValidationConfig = {}) => {
  const { showToasts = true, debounceMs = 300, autoValidate = true } = config;
  const { showToast } = useToast();
  
  const [fieldValidations, setFieldValidations] = useState<Record<string, FieldValidation>>({});
  const [isValidating, setIsValidating] = useState(false);
  const [lastValidation, setLastValidation] = useState<Date | null>(null);

  // Validation d'un champ spécifique
  const validateField = useCallback((
    fieldName: string, 
    value: any, 
    validator: (value: any) => { isValid: boolean; error?: string; warning?: string; success?: string }
  ) => {
    setIsValidating(true);
    
    const result = validator(value);
    
    setFieldValidations(prev => ({
      ...prev,
      [fieldName]: result
    }));

    setLastValidation(new Date());
    setIsValidating(false);

    // Toast de feedback si activé
    if (showToasts) {
      if (result.error) {
        showToast(result.error, 'error');
      } else if (result.warning) {
        showToast(result.warning, 'warning');
      } else if (result.success) {
        showToast(result.success, 'success');
      }
    }

    return result.isValid;
  }, [showToasts, showToast]);

  // Validation de plusieurs champs
  const validateFields = useCallback((
    fieldsToValidate: Array<{
      fieldName: string;
      value: any;
      validator: (value: any) => { isValid: boolean; error?: string; warning?: string; success?: string };
    }>
  ) => {
    setIsValidating(true);
    
    const results: Record<string, FieldValidation> = {};
    let allValid = true;

    for (const { fieldName, value, validator } of fieldsToValidate) {
      const result = validator(value);
      results[fieldName] = result;
      
      if (!result.isValid) {
        allValid = false;
      }
    }

    setFieldValidations(prev => ({ ...prev, ...results }));
    setLastValidation(new Date());
    setIsValidating(false);

    return allValid;
  }, []);

  // Nettoyer les validations
  const clearValidations = useCallback((fieldNames?: string[]) => {
    if (fieldNames) {
      setFieldValidations(prev => {
        const updated = { ...prev };
        fieldNames.forEach(field => {
          delete updated[field];
        });
        return updated;
      });
    } else {
      setFieldValidations({});
    }
  }, []);

  // Obtenir le statut de validation d'un champ
  const getFieldValidation = useCallback((fieldName: string): FieldValidation => {
    return fieldValidations[fieldName] || { isValid: true };
  }, [fieldValidations]);

  // Obtenir la classe CSS pour un champ
  const getFieldClassName = useCallback((fieldName: string, baseClassName = '') => {
    const validation = getFieldValidation(fieldName);
    
    let className = baseClassName;
    
    if (validation.error) {
      className += ' border-red-500 focus:border-red-500 focus:ring-red-500';
    } else if (validation.warning) {
      className += ' border-yellow-500 focus:border-yellow-500 focus:ring-yellow-500';
    } else if (validation.success) {
      className += ' border-green-500 focus:border-green-500 focus:ring-green-500';
    }
    
    return className.trim();
  }, [getFieldValidation]);

  // Statistiques de validation
  const validationStats = useCallback(() => {
    const validations = Object.values(fieldValidations);
    return {
      total: validations.length,
      valid: validations.filter(v => v.isValid).length,
      invalid: validations.filter(v => !v.isValid).length,
      errors: validations.filter(v => v.error).length,
      warnings: validations.filter(v => v.warning).length,
      successes: validations.filter(v => v.success).length
    };
  }, [fieldValidations]);

  // Validation automatique avec debounce
  useEffect(() => {
    if (!autoValidate) return;

    const timeoutId = setTimeout(() => {
      // Ici on pourrait déclencher une validation automatique
      // pour tous les champs qui ont besoin d'être revalidés
    }, debounceMs);

    return () => clearTimeout(timeoutId);
  }, [fieldValidations, autoValidate, debounceMs]);

  return {
    // États
    fieldValidations,
    isValidating,
    lastValidation,
    
    // Actions
    validateField,
    validateFields,
    clearValidations,
    
    // Helpers
    getFieldValidation,
    getFieldClassName,
    validationStats,
    
    // Computed
    hasErrors: Object.values(fieldValidations).some(v => !v.isValid),
    hasWarnings: Object.values(fieldValidations).some(v => v.warning),
    isAllValid: Object.values(fieldValidations).every(v => v.isValid)
  };
};