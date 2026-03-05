export type AlertEventType = 
  | 'alert_created'
  | 'alert_validated'
  | 'alert_dismissed'
  | 'rule_updated'
  | 'rule_created'
  | 'rule_deleted';

export interface AlertEvent {
  type: AlertEventType;
  timestamp: string;
  data: {
    alertId?: number;
    ruleId?: number;
    enqueteId?: number;
    message?: string;
  };
}