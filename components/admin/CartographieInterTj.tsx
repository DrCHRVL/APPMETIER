'use client';

/**
 * Cartographie inter-TJ simplifiée — administrateur général seul.
 * Personnes mises en cause dans au moins deux tribunaux, rapprochées sur le
 * nom. Calculée à la demande dans le navigateur (séquestres des TJ), jamais
 * enregistrée ; chaque lecture de coffre est journalisée côté serveur.
 */
import React, { useMemo, useState } from 'react';
import { Network, Loader2 } from 'lucide-react';
import { cartographieInterTj, type AdminHttp, type CartographieInterTj as Carto } from '@/lib/web/adminGeneral';

const LARGEUR = 640;
const HAUTEUR = 420;
const COULEURS = ['#1f6f54', '#2563eb', '#b45309', '#7c3aed', '#be123c', '#0e7490', '#4d7c0f', '#a16207'];

export const CartographieInterTj: React.FC<{
  tjs: Array<{ id: string, name: string }>;
  clePrivee: CryptoKey | null;
  http: AdminHttp;
  /** Intégrée dans une section qui porte déjà le titre : ni cadre ni titre. */
  sansCadre?: boolean;
}> = ({ tjs, clePrivee, http, sansCadre }) => {
  const [carto, setCarto] = useState<Carto | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');
  const [survol, setSurvol] = useState<string | null>(null);

  const calculer = async () => {
    if (!clePrivee) return;
    setBusy(true); setErreur('');
    try { setCarto(await cartographieInterTj(tjs, clePrivee, http)); }
    catch (e) { setErreur(e instanceof Error ? e.message : 'Calcul impossible'); }
    finally { setBusy(false); }
  };

  // Disposition : tribunaux en cercle, chaque personne au barycentre de ses TJ.
  const graphe = useMemo(() => {
    if (!carto) return null;
    const lus = carto.couverture.filter((c) => c.lu);
    const cx = LARGEUR / 2, cy = HAUTEUR / 2, r = Math.min(cx, cy) - 50;
    const pos = new Map(lus.map((c, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, lus.length) - Math.PI / 2;
      return [c.tj, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), nom: c.nomTj, couleur: COULEURS[i % COULEURS.length] }];
    }));
    const personnes = carto.personnes.slice(0, 80).map((p, i) => {
      const pts = p.tjs.map((t) => pos.get(t.tj)!).filter(Boolean);
      const bx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
      const by = pts.reduce((s, q) => s + q.y, 0) / pts.length;
      // léger décalage déterministe pour que les personnes d'un même couple ne se superposent pas
      const ang = i * 2.399963;
      const d = 14 + (i % 5) * 9;
      return { ...p, x: bx + d * Math.cos(ang) * 0.6, y: by + d * Math.sin(ang) * 0.6, pts };
    });
    return { pos, personnes };
  }, [carto]);

  return (
    <section className={sansCadre ? 'space-y-3' : 'border border-gray-200 rounded-lg p-3 space-y-3'}>
      <div className="flex items-center justify-between gap-2">
        {sansCadre ? <span /> : (
          <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Network className="h-4 w-4 text-emerald-600" /> Cartographie inter-TJ
          </h4>
        )}
        <button className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50"
          onClick={calculer} disabled={busy || !clePrivee}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{carto ? 'Recalculer' : 'Calculer'}
        </button>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Personnes mises en cause dans <b>au moins deux tribunaux</b>, rapprochées sur le nom (ordre des mots, accents et
        casse ignorés). Un signalement à vérifier, pas une identification. Calculée ici, à la demande, jamais enregistrée ;
        chaque lecture est journalisée.
        {!clePrivee && ' Clé d’administration non chargée : reconnectez-vous avec votre phrase.'}
      </p>
      {erreur && <p className="text-xs text-red-600">{erreur}</p>}

      {carto && (
        <>
          <div className="text-[11px] text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
            {carto.couverture.map((c) => (
              <span key={c.tj} title={c.raison}>
                {c.nomTj} : {c.lu ? `${c.personnes} personne${c.personnes > 1 ? 's' : ''}` : <span className="text-amber-700">non lu</span>}
              </span>
            ))}
          </div>

          {carto.personnes.length === 0 ? (
            <p className="text-xs text-gray-500">Aucune personne commune à plusieurs tribunaux.</p>
          ) : (
            <>
              {graphe && (
                <svg viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`} className="w-full max-w-[640px] border border-gray-100 rounded bg-white">
                  {graphe.personnes.map((p) => p.pts.map((q, i) => (
                    <line key={`${p.nom}-${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                      stroke={survol === p.nom ? '#111827' : '#cbd5e1'} strokeWidth={survol === p.nom ? 1.5 : 0.8} />
                  )))}
                  {[...graphe.pos.entries()].map(([id, t]) => (
                    <g key={id}>
                      <circle cx={t.x} cy={t.y} r={18} fill={t.couleur} opacity={0.9} />
                      <text x={t.x} y={t.y + 32} textAnchor="middle" fontSize={11} fill="#374151" fontWeight={600}>{t.nom}</text>
                    </g>
                  ))}
                  {graphe.personnes.map((p) => (
                    <g key={p.nom} onMouseEnter={() => setSurvol(p.nom)} onMouseLeave={() => setSurvol(null)} style={{ cursor: 'default' }}>
                      <circle cx={p.x} cy={p.y} r={p.tjs.length > 2 ? 6 : 4.5} fill={p.tjs.length > 2 ? '#dc2626' : '#f59e0b'} stroke="#fff" strokeWidth={1} />
                      <title>{`${p.nom} — ${p.tjs.map((t) => t.nomTj).join(', ')}`}</title>
                    </g>
                  ))}
                </svg>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                      <th className="px-2 py-1">Personne</th><th className="px-2 py-1">Tribunaux et dossiers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {carto.personnes.map((p) => (
                      <tr key={p.nom} onMouseEnter={() => setSurvol(p.nom)} onMouseLeave={() => setSurvol(null)}
                        className={survol === p.nom ? 'bg-amber-50' : ''}>
                        <td className="px-2 py-1 font-medium text-gray-800 whitespace-nowrap">{p.nom}</td>
                        <td className="px-2 py-1 text-gray-600">
                          {p.tjs.map((t) => (
                            <span key={t.tj} className="mr-3 inline-block">
                              <b>{t.nomTj}</b> : {t.dossiers.map((d) => `${d.numero} (${d.contentieux}${d.statut === 'archive' ? ', archivé' : ''})`).join(', ')}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};
