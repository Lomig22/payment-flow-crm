// Test de l'import CSV Hermès : contrôles, doublons (fichier et CRM), « ne plus contacter », rapport.
// Lancer : npx tsx --env-file=.env.local scripts/tests/linkedin-import.test.ts [instantané-du-crm.json]
// (instantané : SELECT json_agg(...) FROM leads ; sans argument, CRM vide + un lead fictif)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseHermesCsv, analyzeImport, type Existing } from '@/lib/linkedinImport';

const csv = fs.readFileSync(path.join(__dirname, 'fixtures/hermes-test.csv'), 'utf8');
const snapshot: Existing[] = process.argv[2]
  ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  : [{ id: 'x', company: "Cuisin'Vraie", location: 'Saint-Flour', siren: null, linkedin_url: 'https://fr.linkedin.com/in/cuisinvraie', do_not_contact: false }];
// Une entreprise « ne plus contacter » ajoutée à l'instantané
const crm: Existing[] = [...snapshot, { id: 'dnc', company: 'ZZTEST Lima', location: 'Lorient', siren: null, linkedin_url: null, do_not_contact: true }];

const a = analyzeImport(parseHermesCsv(csv), crm);
const reason = (line: number) => a.rejected.find((r) => r.line === line)?.reason ?? 'IMPORTÉE';

console.log(`${a.rows} lignes : ${a.toInsert.length} importable(s), ${a.rejected.length} rejetée(s), ${a.warnings.length} avertissement(s)\n`);
for (const r of a.rejected) console.log(`  rejet  l.${r.line} ${r.name} : ${r.reason}`);
for (const w of a.warnings) console.log(`  avert. l.${w.line} ${w.name} : ${w.warning}`);
for (const l of a.toInsert) console.log(`  import ${l.first_name} ${l.last_name} · ${l.company} · ${l.li_sector ?? 'secteur vide'} · ${l.region ?? 'région ?'} · ${l.linkedin_url}`);

assert.equal(reason(2), 'IMPORTÉE');
assert.match(reason(3), /doublon de la ligne 2/);                   // même URL (autre format)
assert.match(reason(4), /doublon de la ligne 2/);                   // même entreprise + ville (SARL ignoré)
assert.match(reason(5), /doublon de la ligne 2/);                   // même SIREN (espaces ignorés)
assert.match(reason(6), /URL LinkedIn invalide/);                   // page entreprise, pas un profil
assert.match(reason(7), /prénom manquant/);
assert.match(reason(8), /entreprise manquante/);
assert.match(reason(9), /URL LinkedIn manquante/);
assert.match(reason(10), /déjà présent dans le CRM/);
assert.equal(reason(11), 'IMPORTÉE');                               // secteur inconnu : importé, avertissement
assert.ok(a.warnings.some((w) => w.line === 11 && /secteur inconnu/.test(w.warning)));
assert.equal(reason(12), 'IMPORTÉE');
assert.ok(a.warnings.some((w) => w.line === 12 && /SIREN ignoré/.test(w.warning)));
assert.match(reason(13), /ne plus contacter/);                    // entreprise exclue définitivement
assert.match(reason(14), /URL LinkedIn invalide/);                  // URL sans https
const alpha = a.toInsert.find((l) => l.company === 'ZZTEST Menuiserie Alpha')!;
assert.equal(alpha.region, 'Bretagne');
assert.equal(alpha.siren, '111111118');
assert.equal(alpha.linkedin_url, 'https://www.linkedin.com/in/zztest-pf-alpha/');
console.log('\nimport : tous les contrôles attendus sont respectés');
