const { query } = require('../config/database');

const getTags = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.*, COUNT(lt.lead_id) AS lead_count
       FROM tags t
       LEFT JOIN lead_tags lt ON lt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

const createTag = async (req, res, next) => {
  try {
    const { name, color = '#6366f1' } = req.body;
    if (!name) return res.status(400).json({ message: 'Le nom du tag est requis' });

    const result = await query(
      'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *',
      [name.trim(), color]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const updateTag = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    const updates = [];
    const params = [];
    let idx = 1;

    if (name)  { updates.push(`name = $${idx++}`);  params.push(name.trim()); }
    if (color) { updates.push(`color = $${idx++}`); params.push(color); }

    if (!updates.length) return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });

    params.push(id);
    const result = await query(
      `UPDATE tags SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (!result.rows[0]) return res.status(404).json({ message: 'Tag introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const deleteTag = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM tags WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Tag introuvable' });
    res.json({ message: 'Tag supprimé', id });
  } catch (err) {
    next(err);
  }
};

module.exports = { getTags, createTag, updateTag, deleteTag };
