const multer = require('multer');
const { query, pool } = require('../config/database');
const { parseCSV } = require('../services/csvImport');

// Multer: store file in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(csv|txt)$/i)) {
      return cb(new Error('Seuls les fichiers CSV sont acceptés'), false);
    }
    cb(null, true);
  },
});

const getLeads = async (req, res, next) => {
  try {
    const {
      setter_id, status, quality, search,
      page = 1, limit = 20,
      sort = 'created_at', order = 'desc',
    } = req.query;

    const validSorts = ['created_at', 'updated_at', 'last_name', 'status', 'lead_quality'];
    const validOrders = ['asc', 'desc'];
    const safeSort  = validSorts.includes(sort)  ? `l.${sort}` : 'l.created_at';
    const safeOrder = validOrders.includes(order) ? order       : 'desc';

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    // Setters only see their own leads
    if (req.user.role !== 'admin') {
      conditions.push(`l.setter_id = $${paramIdx++}`);
      params.push(req.user.id);
    } else if (setter_id) {
      conditions.push(`l.setter_id = $${paramIdx++}`);
      params.push(setter_id);
    }

    if (status) {
      conditions.push(`l.status = $${paramIdx++}`);
      params.push(status);
    }

    if (quality) {
      conditions.push(`l.lead_quality = $${paramIdx++}`);
      params.push(quality);
    }

    if (search) {
      conditions.push(`(
        l.first_name ILIKE $${paramIdx} OR l.last_name ILIKE $${paramIdx} OR
        l.company ILIKE $${paramIdx} OR l.email ILIKE $${paramIdx} OR
        l.phone ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countResult = await query(
      `SELECT COUNT(*) FROM leads l ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Pagination
    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;

    // Main query with setter info + tags
    const leadsResult = await query(
      `SELECT
        l.*,
        u.first_name AS setter_first_name,
        u.last_name  AS setter_last_name,
        u.email      AS setter_email,
        COALESCE(
          json_agg(
            json_build_object('id', t.id, 'name', t.name, 'color', t.color)
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'
        ) AS tags
       FROM leads l
       LEFT JOIN users u ON l.setter_id = u.id
       LEFT JOIN lead_tags lt ON l.id = lt.lead_id
       LEFT JOIN tags t ON lt.tag_id = t.id
       ${where}
       GROUP BY l.id, u.first_name, u.last_name, u.email
       ORDER BY ${safeSort} ${safeOrder}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limitNum, offset]
    );

    const leads = leadsResult.rows.map((row) => ({
      ...row,
      setter: row.setter_first_name
        ? { first_name: row.setter_first_name, last_name: row.setter_last_name, email: row.setter_email }
        : null,
    }));

    res.json({
      data: leads,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

const getLead = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT
        l.*,
        u.id AS setter_user_id, u.first_name AS setter_first_name,
        u.last_name AS setter_last_name, u.email AS setter_email,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
          FILTER (WHERE t.id IS NOT NULL), '[]'
        ) AS tags
       FROM leads l
       LEFT JOIN users u ON l.setter_id = u.id
       LEFT JOIN lead_tags lt ON l.id = lt.lead_id
       LEFT JOIN tags t ON lt.tag_id = t.id
       WHERE l.id = $1
       GROUP BY l.id, u.id, u.first_name, u.last_name, u.email`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Lead introuvable' });
    }

    const lead = result.rows[0];

    // Setters can only see their own leads
    if (req.user.role !== 'admin' && lead.setter_id !== req.user.id) {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }

    // Fetch history
    const historyResult = await query(
      `SELECT h.*, u.first_name, u.last_name
       FROM lead_history h
       LEFT JOIN users u ON h.user_id = u.id
       WHERE h.lead_id = $1
       ORDER BY h.created_at DESC`,
      [id]
    );

    res.json({
      ...lead,
      setter: lead.setter_user_id
        ? { id: lead.setter_user_id, first_name: lead.setter_first_name, last_name: lead.setter_last_name, email: lead.setter_email }
        : null,
      history: historyResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

const createLead = async (req, res, next) => {
  try {
    const {
      first_name, last_name, company, phone, email, location,
      called, action_in_progress, lead_quality, need_identified,
      setter_id, appointment_taken, appointment_honored, quote_sent,
      r2_planned, r3_planned, status, notes, tags,
    } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ message: 'Prénom et nom sont requis' });
    }

    // Setters can only create leads assigned to themselves
    const assignedSetter = req.user.role === 'admin' ? (setter_id || null) : req.user.id;

    const result = await query(
      `INSERT INTO leads (
        first_name, last_name, company, phone, email, location,
        called, action_in_progress, lead_quality, need_identified,
        setter_id, appointment_taken, appointment_honored, quote_sent,
        r2_planned, r3_planned, status, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        first_name, last_name, company || null, phone || null, email || null, location || null,
        called || false, action_in_progress || 'to_call', lead_quality || null, need_identified || null,
        assignedSetter, appointment_taken || false, appointment_honored || false, quote_sent || false,
        r2_planned || false, r3_planned || false, status || 'in_progress', notes || null,
      ]
    );

    const lead = result.rows[0];

    // Log creation
    await query(
      'INSERT INTO lead_history (lead_id, user_id, action_note) VALUES ($1, $2, $3)',
      [lead.id, req.user.id, 'Lead créé']
    );

    // Attach tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      for (const tagId of tags) {
        await query('INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [lead.id, tagId]);
      }
    }

    res.status(201).json(lead);
  } catch (err) {
    next(err);
  }
};

const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch current state to detect changes
    const current = await query('SELECT * FROM leads WHERE id = $1', [id]);
    if (!current.rows[0]) {
      return res.status(404).json({ message: 'Lead introuvable' });
    }

    const lead = current.rows[0];

    // Setters can only update their own leads
    if (req.user.role !== 'admin' && lead.setter_id !== req.user.id) {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }

    const allowedFields = [
      'first_name', 'last_name', 'company', 'phone', 'email', 'location',
      'called', 'action_in_progress', 'lead_quality', 'need_identified',
      'appointment_taken', 'appointment_honored', 'quote_sent',
      'r2_planned', 'r3_planned', 'status', 'notes',
    ];

    // Admin-only fields
    if (req.user.role === 'admin') {
      allowedFields.push('setter_id');
    }

    const updates = [];
    const params = [];
    let paramIdx = 1;
    const historyEntries = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined && req.body[field] !== lead[field]) {
        updates.push(`${field} = $${paramIdx++}`);
        params.push(req.body[field]);
        historyEntries.push({ field, old: lead[field], new: req.body[field] });
      }
    }

    if (updates.length === 0 && !req.body.tags) {
      return res.json(lead);
    }

    let updatedLead = lead;
    if (updates.length > 0) {
      params.push(id);
      const result = await query(
        `UPDATE leads SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
        params
      );
      updatedLead = result.rows[0];
    }

    // Log each field change
    for (const entry of historyEntries) {
      await query(
        'INSERT INTO lead_history (lead_id, user_id, field_changed, old_value, new_value) VALUES ($1,$2,$3,$4,$5)',
        [id, req.user.id, entry.field, String(entry.old ?? ''), String(entry.new ?? '')]
      );
    }

    // Update tags if provided
    if (req.body.tags !== undefined) {
      await query('DELETE FROM lead_tags WHERE lead_id = $1', [id]);
      if (Array.isArray(req.body.tags) && req.body.tags.length > 0) {
        for (const tagId of req.body.tags) {
          await query('INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, tagId]);
        }
      }
    }

    res.json(updatedLead);
  } catch (err) {
    next(err);
  }
};

const deleteLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM leads WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Lead introuvable' });
    }
    res.json({ message: 'Lead supprimé', id });
  } catch (err) {
    next(err);
  }
};

const importLeads = async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni' });
    }

    const { assignment_mode = 'round_robin', setter_id } = req.body;

    if (assignment_mode === 'manual' && !setter_id) {
      return res.status(400).json({ message: 'setter_id requis pour le mode manuel' });
    }

    const { leads, total } = parseCSV(req.file.buffer);

    if (total === 0) {
      return res.status(400).json({ message: 'Aucun lead valide trouvé dans le fichier' });
    }

    // Get active setters for round-robin
    let setters = [];
    if (assignment_mode === 'round_robin') {
      const setterResult = await query(
        "SELECT id FROM users WHERE role = 'setter' AND is_active = true ORDER BY created_at"
      );
      setters = setterResult.rows.map((r) => r.id);
      if (setters.length === 0) {
        return res.status(400).json({ message: 'Aucun setter actif trouvé pour l\'attribution automatique' });
      }
    }

    await client.query('BEGIN');

    // Create import batch
    const batchResult = await client.query(
      `INSERT INTO import_batches (user_id, filename, total_leads, assigned_setter_id, assignment_mode)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, req.file.originalname, total, setter_id || null, assignment_mode]
    );
    const batchId = batchResult.rows[0].id;

    const insertedLeads = [];

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const assignedTo =
        assignment_mode === 'manual' ? setter_id : setters[i % setters.length];

      const result = await client.query(
        `INSERT INTO leads (
          first_name, last_name, company, phone, email, location,
          setter_id, import_batch_id, status, action_in_progress
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_progress','to_call')
         RETURNING *`,
        [
          lead.first_name || 'Inconnu',
          lead.last_name  || 'Inconnu',
          lead.company    || null,
          lead.phone      || null,
          lead.email      || null,
          lead.location   || null,
          assignedTo      || null,
          batchId,
        ]
      );

      const newLead = result.rows[0];
      insertedLeads.push(newLead);

      await client.query(
        'INSERT INTO lead_history (lead_id, user_id, action_note) VALUES ($1,$2,$3)',
        [newLead.id, req.user.id, `Lead importé (batch: ${req.file.originalname})`]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: `${total} leads importés avec succès`,
      batchId,
      total,
      assignment_mode,
      leads: insertedLeads,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const assignLeads = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { leadIds, setterId, mode = 'manual' } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: 'leadIds requis' });
    }

    let setters = [];
    if (mode === 'round_robin') {
      const result = await query(
        "SELECT id FROM users WHERE role = 'setter' AND is_active = true ORDER BY created_at"
      );
      setters = result.rows.map((r) => r.id);
    } else {
      if (!setterId) return res.status(400).json({ message: 'setterId requis' });
      setters = [setterId];
    }

    await client.query('BEGIN');

    for (let i = 0; i < leadIds.length; i++) {
      const assignedTo = setters[i % setters.length];
      await client.query('UPDATE leads SET setter_id = $1 WHERE id = $2', [assignedTo, leadIds[i]]);
      await client.query(
        'INSERT INTO lead_history (lead_id, user_id, field_changed, new_value, action_note) VALUES ($1,$2,$3,$4,$5)',
        [leadIds[i], req.user.id, 'setter_id', assignedTo, 'Lead réassigné']
      );
    }

    await client.query('COMMIT');
    res.json({ message: `${leadIds.length} lead(s) assigné(s)` });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { getLeads, getLead, createLead, updateLead, deleteLead, importLeads, assignLeads, upload };
