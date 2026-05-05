const { query } = require('../config/database');

const getStats = async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const setterFilter = isAdmin ? '' : `WHERE setter_id = '${req.user.id}'`;
    const setterParam  = isAdmin ? [] : [req.user.id];
    const whereClause  = isAdmin ? '' : 'WHERE l.setter_id = $1';

    // Overview stats
    const overviewResult = await query(
      `SELECT
         COUNT(*)                                                    AS total_leads,
         COUNT(*) FILTER (WHERE called = true)                      AS leads_called,
         COUNT(*) FILTER (WHERE appointment_taken = true)           AS appointments_taken,
         COUNT(*) FILTER (WHERE appointment_honored = true)         AS appointments_honored,
         COUNT(*) FILTER (WHERE quote_sent = true)                  AS quotes_sent,
         COUNT(*) FILTER (WHERE status = 'client')                  AS clients_signed,
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
       FROM leads ${setterFilter}`,
      setterParam
    );

    // By quality
    const qualityResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE lead_quality = 'hot')  AS hot,
         COUNT(*) FILTER (WHERE lead_quality = 'warm') AS warm,
         COUNT(*) FILTER (WHERE lead_quality = 'cold') AS cold,
         COUNT(*) FILTER (WHERE lead_quality IS NULL)  AS unqualified
       FROM leads ${setterFilter}`,
      setterParam
    );

    // By status
    const statusResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
         COUNT(*) FILTER (WHERE status = 'client')      AS client,
         COUNT(*) FILTER (WHERE status = 'lost')        AS lost
       FROM leads ${setterFilter}`,
      setterParam
    );

    // By setter (admin only)
    let bySetterData = [];
    if (isAdmin) {
      const setterResult = await query(
        `SELECT
           u.id AS setter_id,
           u.first_name || ' ' || u.last_name AS name,
           COUNT(l.id)                                          AS total,
           COUNT(l.id) FILTER (WHERE l.called = true)          AS called,
           COUNT(l.id) FILTER (WHERE l.status = 'client')      AS clients,
           ROUND(
             CASE WHEN COUNT(l.id) > 0
               THEN COUNT(l.id) FILTER (WHERE l.status = 'client')::numeric / COUNT(l.id) * 100
               ELSE 0 END, 1
           ) AS conversion_rate
         FROM users u
         LEFT JOIN leads l ON l.setter_id = u.id
         WHERE u.role = 'setter'
         GROUP BY u.id, u.first_name, u.last_name
         ORDER BY clients DESC`
      );
      bySetterData = setterResult.rows;
    }

    // Timeline: last 30 days
    const timelineResult = await query(
      `SELECT
         DATE_TRUNC('day', l.created_at)::date AS date,
         COUNT(*)                                              AS leads_created,
         COUNT(*) FILTER (WHERE l.status = 'client')          AS clients,
         COUNT(*) FILTER (WHERE l.appointment_taken = true)   AS appointments
       FROM leads l
       ${whereClause ? whereClause + ' AND' : 'WHERE'} l.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1
       ORDER BY 1`,
      setterParam
    );

    res.json({
      overview:   overviewResult.rows[0],
      by_quality: qualityResult.rows[0],
      by_status:  statusResult.rows[0],
      by_setter:  bySetterData,
      timeline:   timelineResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

const getSetterLeaderboard = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         u.id, u.first_name, u.last_name, u.email, u.avatar_url,
         COUNT(l.id)                                              AS total_leads,
         COUNT(l.id) FILTER (WHERE l.called = true)              AS called,
         COUNT(l.id) FILTER (WHERE l.appointment_taken = true)   AS appointments,
         COUNT(l.id) FILTER (WHERE l.appointment_honored = true) AS appointments_honored,
         COUNT(l.id) FILTER (WHERE l.status = 'client')          AS clients,
         ROUND(
           CASE WHEN COUNT(l.id) > 0
             THEN COUNT(l.id) FILTER (WHERE l.status = 'client')::numeric / COUNT(l.id) * 100
             ELSE 0 END, 1
         ) AS conversion_rate
       FROM users u
       LEFT JOIN leads l ON l.setter_id = u.id
       WHERE u.role = 'setter' AND u.is_active = true
       GROUP BY u.id
       ORDER BY clients DESC, conversion_rate DESC`
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

module.exports = { getStats, getSetterLeaderboard };
