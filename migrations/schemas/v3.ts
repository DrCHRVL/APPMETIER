export const v3 = async (data: any) => {
  // v3 : introduction du référentiel NATINF.
  //
  // Migration purement additive — aucune donnée existante n'est transformée.
  // Les nouveaux champs sont tous optionnels et se remplissent à l'usage :
  //   - DossierInstruction.saisine          (saisine in rem structurée)
  //   - InfractionReproche.natinfCode/-Ref  (chef de MEX rattaché à un NATINF)
  //   - TagDefinition.natinfCodes           (lien tag « infractions » -> NATINF)
  // On se contente donc de marquer la version.
  return {
    ...data,
    version: 3,
  };
};
