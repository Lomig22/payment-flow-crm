const bcrypt = require('bcryptjs');
const { query } = require('../config/database');

const getUsers = async (req, res, next) => {
  try {
    const { role, is_active } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role) { conditions.push(`u.role = $${idx++}`); params.push(role); }
    if (is_active !== undefined) { conditions.push(`u.is_active = $${idx++}`); params.push(is_active === 'true'); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT
         u.id, u.email, u.first_name, u.last_name, u.role, u.is_active, u.avatar_url, u.created_at,
         COUNT(l.id)                                           AS total_leads,
         COUNT(l.id) FILTER (WHERE l.called = true)           AS leads_called,
         COUNT(l.id) FILTER (WHERE l.appointment_taken = true) AS appointments_taken,
         COUNT(l.id) FILTER (WHERE l.status = 'client')       AS clients_signed
       FROM users u
       LEFT JOIN leads l ON l.setter_id = u.id
       ${where}
       GROUP BY u.id
       ORDER BY u.created_at`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

const getUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Setters can only view themselves
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }

    const result = await query(
      `SELECT id, email, first_name, last_name, role, is_active, avatar_url, created_at
       FROM users WHERE id = $1`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const createUser = async (req, res, next) => {
  try {
    const { email, password, first_name, last_name, role = 'setter' } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ message: 'Email, mot de passe, prénom et nom sont requis' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 8 caractères' });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, first_name, last_name, role, is_active, created_at`,
      [email.toLowerCase().trim(), hash, first_name, last_name, role]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }

    const { first_name, last_name, email, password, avatar_url, role, is_active } = req.body;

    const current = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!current.rows[0]) {
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }

    const updates = [];
    const params = [];
    let idx = 1;

    if (first_name)  { updates.push(`first_name = $${idx++}`);  params.push(first_name); }
    if (last_name)   { updates.push(`last_name = $${idx++}`);   params.push(last_name); }
    if (email)       { updates.push(`email = $${idx++}`);       params.push(email.toLowerCase().trim()); }
    if (avatar_url)  { updates.push(`avatar_url = $${idx++}`);  params.push(avatar_url); }

    // Admin-only fields
    if (req.user.role === 'admin') {
      if (role !== undefined)      { updates.push(`role = $${idx++}`);      params.push(role); }
      if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); params.push(is_active); }
    }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${idx++}`);
      params.push(hash);
    }

    if (updates.length === 0) {
      return res.json(current.rows[0]);
    }

    params.push(id);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, email, first_name, last_name, role, is_active, avatar_url, created_at`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({ message: 'Vous ne pouvez pas désactiver votre propre compte' });
    }

    const result = await query(
      'UPDATE users SET is_active = false WHERE id = $1 RETURNING id',
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }

    res.json({ message: 'Utilisateur désactivé', id });
  } catch (err) {
    next(err);
  }
};

const getUserPerformance = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }

    const result = await query(
      `SELECT
         COUNT(*)                                                    AS total_leads,
         COUNT(*) FILTER (WHERE called = true)                      AS called_leads,
         COUNT(*) FILTER (WHERE appointment_taken = true)           AS appointments_taken,
         COUNT(*) FILTER (WHERE appointment_honored = true)         AS appointments_honored,
         COUNT(*) FILTER (WHERE quote_sent = true)                  AS quotes_sent,
         COUNT(*) FILTER (WHERE r2_planned = true)                  AS r2_planned,
         COUNT(*) FILTER (WHERE r3_planned = true)                  AS r3_planned,
         COUNT(*) FILTER (WHERE status = 'client')                  AS clients_signed,
         COUNT(*) FILTER (WHERE status = 'lost')                    AS lost,
         COUNT(*) FILTER (WHERE status = 'in_progress')             AS in_progress,
         COUNT(*) FILTER (WHERE lead_quality = 'hot')               AS hot_leads,
         COUNT(*) FILTER (WHERE lead_quality = 'warm')              AS warm_leads,
         COUNT(*) FILTER (WHERE lead_quality = 'cold')              AS cold_leads,
         ROUND(
           CASE WHEN COUNT(*) > 0
             THEN COUNT(*) FILTER (WHERE status = 'client')::numeric / COUNT(*) * 100
             ELSE 0 END, 1
         ) AS conversion_rate,
         ROUND(
           CASE WHEN COUNT(*) FILTER (WHERE appointment_taken = true) > 0
             THEN (COUNT(*) FILTER (WHERE appointment_taken = true) -
                   COUNT(*) FILTER (WHERE appointment_honored = true))::numeric /
                  COUNT(*) FILTER (WHERE appointment_taken = true) * 100
             ELSE 0 END, 1
         ) AS no_show_rate
       FROM leads WHERE setter_id = $1`,
      [id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

module.exports = { getUsers, getUser, createUser, updateUser, deleteUser, getUserPerformance };
