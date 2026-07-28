/**
 * Normalise un numéro de téléphone FR en forme nationale canonique, pour comparer
 * les doublons de façon fiable. Les trois écritures d'un même numéro
 *   « +33 6 12 34 56 78 », « 0033 6 12 34 56 78 » et « 06 12 34 56 78 »
 * donnent toutes « 0612345678 ».
 *
 * Retourne '' pour une entrée sans chiffre (placeholders « — », « N/A »…).
 */
export function normalizePhone(raw: string | null | undefined): string {
  let d = (raw || '').replace(/\D/g, ''); // chiffres uniquement (retire aussi « + », espaces, points…)
  if (!d) return '';
  if (d.startsWith('0033'))                        d = d.slice(4); // 0033 XXXXXXXXX
  else if (d.startsWith('33') && d.length === 11)  d = d.slice(2); // 33 + 9 chiffres (ex-« +33 »)
  else if (d.startsWith('0'))                      d = d.slice(1); // 0XXXXXXXXX
  return '0' + d;
}
