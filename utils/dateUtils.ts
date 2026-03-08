import { format, differenceInDays, addDays, addMonths, isBefore, isAfter, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

export const DateUtils = {
  formatDate: (date: Date | string | null): string => {
    if (!date) return '';
    try {
      const dateObj = typeof date === 'string' ? parseISO(date) : date;
      if (isNaN(dateObj.getTime())) return '';
      return format(dateObj, 'dd/MM/yyyy', { locale: fr });
    } catch (error) {
      console.error('Error formatting date:', error);
      return '';
    }
  },

  getDaysDifference: (date1: Date | string, date2: Date | string): number => {
    try {
      const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
      const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
      return Math.abs(differenceInDays(d1, d2));
    } catch (error) {
      console.error('Error calculating days difference:', error);
      return 0;
    }
  },

  addDays: (date: Date | string, days: number): string => {
    try {
      const dateObj = typeof date === 'string' ? parseISO(date) : date;
      if (isNaN(dateObj.getTime())) return '';
      const newDate = addDays(dateObj, days);
      return format(newDate, 'yyyy-MM-dd');
    } catch (error) {
      console.error('Error adding days:', error);
      return '';
    }
  },

 calculateActeEndDate: (startDate: string, duration: string): string => {
    try {
      // Validate inputs
      if (!startDate || !duration) {
        console.warn('Missing required parameters for calculateActeEndDate');
        return '';
      }

      // Parse duration as integer
      const days = parseInt(duration, 10);
      if (isNaN(days) || days <= 0) {
        console.warn('Invalid duration value:', duration);
        return '';
      }

      // Parse and validate start date
      const start = parseISO(startDate);
      if (isNaN(start.getTime())) {
        console.warn('Invalid start date:', startDate);
        return '';
      }

      // Calculate end date
      const end = addDays(start, days);
      return format(end, 'yyyy-MM-dd');

    } catch (error) {
      console.warn('Error calculating acte end date:', {
        startDate,
        duration,
        error
      });
      return '';
    }
  },

  isAfter: (date1: string, date2: string): boolean => {
    try {
      const d1 = parseISO(date1);
      const d2 = parseISO(date2);
      return isAfter(d1, d2);
    } catch (error) {
      console.error('Error in isAfter:', error);
      return false;
    }
  },

  calculateInitialEndDate: (poseDate: string, duration: string): string => {
    try {
      const days = parseInt(duration);
      const pose = parseISO(poseDate);
      const endDate = addDays(pose, days);
      return format(endDate, 'yyyy-MM-dd');
    } catch (error) {
      console.error('Error calculating initial end date:', error);
      return '';
    }
  },

  calculateProlongationEndDate: (initialEndDate: string, prolongationDuration: string): string => {
    try {
      const days = parseInt(prolongationDuration);
      const end = parseISO(initialEndDate);
      const newEndDate = addDays(end, days);
      return format(newEndDate, 'yyyy-MM-dd');
    } catch (error) {
      console.error('Error calculating prolongation end date:', error);
      return '';
    }
  },

  isValidDate: (date: string | null): boolean => {
    if (!date) return false;
    try {
      const dateObj = parseISO(date);
      return !isNaN(dateObj.getTime());
    } catch {
      return false;
    }
  },

  // Ajoute N mois calendaires à une date (28 fév + 1 mois = 28 mars)
  addCalendarMonths: (date: Date | string, months: number): string => {
    try {
      const dateObj = typeof date === 'string' ? parseISO(date) : date;
      if (isNaN(dateObj.getTime())) return '';
      const newDate = addMonths(dateObj, months);
      return format(newDate, 'yyyy-MM-dd');
    } catch (error) {
      console.error('Error adding calendar months:', error);
      return '';
    }
  },

  // Calcule la date de fin selon l'unité : 'jours' (addDays) ou 'mois' (addMonths calendaires)
  calculateEndDateWithUnit: (startDate: string, value: string, unit: 'jours' | 'mois'): string => {
    try {
      if (!startDate || !value) return '';
      const n = parseInt(value, 10);
      if (isNaN(n) || n <= 0) return '';
      if (unit === 'mois') {
        return DateUtils.addCalendarMonths(startDate, n);
      }
      return DateUtils.calculateActeEndDate(startDate, value);
    } catch (error) {
      console.error('Error in calculateEndDateWithUnit:', error);
      return '';
    }
  },

  validateDateRange: (startDate: string, endDate: string): boolean => {
    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      return !isNaN(start.getTime()) && 
             !isNaN(end.getTime()) && 
             !isBefore(end, start);
    } catch {
      return false;
    }
  }
};