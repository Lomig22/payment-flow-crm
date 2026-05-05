const { parse } = require('csv-parse/sync');

// Aliases for intelligent column mapping (French + English)
const COLUMN_ALIASES = {
  first_name: ['prénom', 'prenom', 'firstname', 'first_name', 'first name', 'given name', 'nom de prénom', 'givenname'],
  last_name:  ['nom', 'lastname', 'last_name', 'last name', 'surname', 'family name', 'nom de famille'],
  company:    ['société', 'societe', 'entreprise', 'company', 'organization', 'organisation', 'structure', 'raison sociale'],
  phone:      ['téléphone', 'telephone', 'phone', 'tel', 'mobile', 'portable', 'numéro', 'numero', 'tél', 'phone number'],
  email:      ['email', 'e-mail', 'mail', 'courriel', 'adresse mail', 'adresse email'],
  location:   ['localisation', 'location', 'ville', 'city', 'adresse', 'address', 'région', 'region', 'code postal', 'zip', 'postal'],
};

const normalizeHeader = (header) =>
  header
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // remove accents for comparison

const buildColumnMap = (headers) => {
  const map = {};
  const normalizedHeaders = headers.map((h) => normalizeHeader(h));

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeader(alias);
      const idx = normalizedHeaders.findIndex((h) => h === normalizedAlias);
      if (idx !== -1 && !map[field]) {
        map[field] = headers[idx]; // original header key
        break;
      }
    }
  }

  return map;
};

const mapRow = (row, columnMap) => {
  const lead = {};
  for (const [field, header] of Object.entries(columnMap)) {
    const value = row[header]?.toString().trim() || null;
    if (value) lead[field] = value;
  }
  return lead;
};

const parseCSV = (buffer) => {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  if (!records || records.length === 0) {
    throw new Error('Le fichier CSV est vide ou mal formaté');
  }

  const headers = Object.keys(records[0]);
  const columnMap = buildColumnMap(headers);

  const leads = records
    .map((row) => mapRow(row, columnMap))
    .filter((lead) => lead.first_name || lead.last_name || lead.email || lead.phone);

  return { leads, columnMap, total: leads.length };
};

module.exports = { parseCSV, buildColumnMap };
