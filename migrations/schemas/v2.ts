export const v2 = async (data: any) => {
  return {
    version: 2,
    ...data,
    // Ajoutez ici les modifications de la v2
    customTags: {
      ...data.customTags,
      // Nouveaux champs v2 si nécessaire
    }
  };
};