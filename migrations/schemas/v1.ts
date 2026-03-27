export const v1 = async (data: any) => {
  // Migration initiale : structure de base
  return {
    version: 1,
    enquetes: data.enquetes || [],
    alerts: data.alerts || [],
    customTags: data.customTags || {
      services: [],
      infractions: [],
      duree: [],
      suivi: []
    },
    alertRules: data.alertRules || []
  };
};