export const v2 = async (data: any) => {
  return {
    ...data,
    version: 2,
    // Ajoutez ici les modifications de la v2
    customTags: {
      ...data.customTags,
      // Nouveaux champs v2 si nécessaire
    }
  };
};