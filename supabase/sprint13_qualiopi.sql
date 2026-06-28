-- ============================================================
-- Sprint 13 — Pole Qualiopi : table dediee + dashboard
--   Nouvelle cible de prospection (organismes de formation visant la
--   certification Qualiopi, sans site web). Table separee qualiopi_leads
--   + historique dedie + RPC dashboard/leaderboard calques sur le cold call.
--   Memes statuts que le cold call (enum lead_status reutilise).
-- A executer dans Supabase > SQL Editor (ou via psql -f)
-- ============================================================

-- ---------- Table principale ----------
CREATE TABLE IF NOT EXISTS qualiopi_leads (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company             TEXT NOT NULL,                 -- nom_entreprise
  dirigeant           TEXT,                          -- nom du dirigeant
  activite            TEXT,                          -- secteur / activite
  phone               VARCHAR(50),
  email               VARCHAR(255),
  city                VARCHAR(255),                  -- ville
  has_website         BOOLEAN NOT NULL DEFAULT false,
  -- Suivi commercial (calque sur leads)
  called              BOOLEAN NOT NULL DEFAULT false,
  lead_quality        lead_quality,
  need_identified     TEXT,
  setter_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  appointment_taken   BOOLEAN NOT NULL DEFAULT false,
  appointment_honored BOOLEAN NOT NULL DEFAULT false,
  quote_sent          BOOLEAN NOT NULL DEFAULT false,
  status              lead_status NOT NULL DEFAULT 'in_progress',
  notes               TEXT,
  import_batch_id     UUID,                          -- pour l'import a venir
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Historique (semantique "etat actuel" du dashboard) ----------
CREATE TABLE IF NOT EXISTS qualiopi_lead_history (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  qualiopi_lead_id UUID NOT NULL REFERENCES qualiopi_leads(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  field_changed    VARCHAR(100),
  old_value        TEXT,
  new_value        TEXT,
  action_note      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qualiopi_leads_setter  ON qualiopi_leads(setter_id);
CREATE INDEX IF NOT EXISTS idx_qualiopi_leads_status  ON qualiopi_leads(status);
CREATE INDEX IF NOT EXISTS idx_qualiopi_leads_phone   ON qualiopi_leads(phone);
CREATE INDEX IF NOT EXISTS idx_qualiopi_leads_created ON qualiopi_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_qualiopi_history_lead  ON qualiopi_lead_history(qualiopi_lead_id);

-- updated_at automatique (reutilise la fonction trigger existante)
DROP TRIGGER IF EXISTS update_qualiopi_leads_updated_at ON qualiopi_leads;
CREATE TRIGGER update_qualiopi_leads_updated_at
  BEFORE UPDATE ON qualiopi_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------- RPC dashboard (calque get_dashboard_stats, sans filtre source) ----------
CREATE OR REPLACE FUNCTION public.get_qualiopi_dashboard_stats(p_setter_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_start date := CURRENT_DATE - p_days;
  v_result json;
BEGIN
  SELECT json_build_object(
    'overview', json_build_object(
      'total_leads',          COUNT(*),
      'leads_called',         COUNT(*) FILTER (WHERE called = true),
      'appointments_taken',   COUNT(*) FILTER (WHERE appointment_taken = true),
      'appointments_honored', COUNT(*) FILTER (WHERE appointment_honored = true),
      'quotes_sent',          COUNT(*) FILTER (WHERE quote_sent = true),
      'clients_signed',       COUNT(*) FILTER (WHERE status = 'client'),
      'conversion_rate',      ROUND(CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER (WHERE status = 'client')::numeric / COUNT(*) * 100 ELSE 0 END, 1),
      'no_show_rate',         ROUND(CASE WHEN COUNT(*) FILTER (WHERE appointment_taken = true) > 0
                                       THEN (COUNT(*) FILTER (WHERE appointment_taken = true) - COUNT(*) FILTER (WHERE appointment_honored = true))::numeric / COUNT(*) FILTER (WHERE appointment_taken = true) * 100
                                       ELSE 0 END, 1)
    ),
    'by_quality', json_build_object(
      'hot', COUNT(*) FILTER (WHERE lead_quality = 'hot'),
      'warm', COUNT(*) FILTER (WHERE lead_quality = 'warm'),
      'cold', COUNT(*) FILTER (WHERE lead_quality = 'cold'),
      'unqualified', COUNT(*) FILTER (WHERE lead_quality IS NULL)
    ),
    -- Tous les statuts cold call (pour le Funnel par statut + compat ascendante)
    'by_status', json_build_object(
      'in_progress',    COUNT(*) FILTER (WHERE status = 'in_progress'),
      'to_follow_up',   COUNT(*) FILTER (WHERE status = 'to_follow_up'),
      'to_follow_up_2', COUNT(*) FILTER (WHERE status = 'to_follow_up_2'),
      'appointment',    COUNT(*) FILTER (WHERE status = 'appointment'),
      'r2',             COUNT(*) FILTER (WHERE status = 'r2'),
      'client',         COUNT(*) FILTER (WHERE status = 'client'),
      'lost',           COUNT(*) FILTER (WHERE status = 'lost')
    )
  ) INTO v_result
  FROM qualiopi_leads
  WHERE TRUE
    AND created_at >= v_start
    AND (p_setter_id IS NULL OR setter_id = p_setter_id);

  RETURN json_build_object(
    'overview',  v_result->'overview',
    'by_quality', v_result->'by_quality',
    'by_status', v_result->'by_status',

    -- Performance par setter (cumulé sur la fenêtre) + bucket « Non assigné ».
    'by_setter', COALESCE((
      SELECT json_agg(s) FROM (
        SELECT * FROM (
          SELECT
            u.id as setter_id,
            u.first_name || ' ' || u.last_name as name,
            COUNT(l.id) as total,
            COUNT(l.id) FILTER (WHERE l.called = true) as called,
            COUNT(l.id) FILTER (WHERE l.status = 'to_follow_up') as follow_ups,
            COUNT(l.id) FILTER (WHERE l.status = 'to_follow_up_2') as follow_ups_2,
            COUNT(l.id) FILTER (WHERE l.appointment_taken = true) as appointments,
            COUNT(l.id) FILTER (WHERE l.status = 'lost') as lost,
            COUNT(l.id) FILTER (WHERE l.status = 'client') as clients,
            ROUND(CASE WHEN COUNT(l.id) > 0 THEN COUNT(l.id) FILTER (WHERE l.status = 'client')::numeric / COUNT(l.id) * 100 ELSE 0 END, 1) as conversion_rate
          FROM users u
          LEFT JOIN qualiopi_leads l ON l.setter_id = u.id AND TRUE AND l.created_at >= v_start
          WHERE u.role = 'setter' AND u.is_active = true
            AND 'qualiopi' = ANY(u.acquisition_sources)
          GROUP BY u.id, u.first_name, u.last_name

          UNION ALL

          SELECT
            NULL::uuid as setter_id,
            'Non assigné' as name,
            COUNT(l.id) as total,
            COUNT(l.id) FILTER (WHERE l.called = true) as called,
            COUNT(l.id) FILTER (WHERE l.status = 'to_follow_up') as follow_ups,
            COUNT(l.id) FILTER (WHERE l.status = 'to_follow_up_2') as follow_ups_2,
            COUNT(l.id) FILTER (WHERE l.appointment_taken = true) as appointments,
            COUNT(l.id) FILTER (WHERE l.status = 'lost') as lost,
            COUNT(l.id) FILTER (WHERE l.status = 'client') as clients,
            ROUND(CASE WHEN COUNT(l.id) > 0 THEN COUNT(l.id) FILTER (WHERE l.status = 'client')::numeric / COUNT(l.id) * 100 ELSE 0 END, 1) as conversion_rate
          FROM qualiopi_leads l
          WHERE TRUE AND l.created_at >= v_start AND l.setter_id IS NULL
          HAVING COUNT(l.id) > 0
        ) rows
        ORDER BY clients DESC, total DESC
      ) s
    ), '[]'::json),

    -- Timeline : leads_created par date de création ; clients & appointments
    -- attribués au jour RÉEL de l'action (dernière transition via qualiopi_lead_history),
    -- et seulement si le lead est toujours dans cet état (sémantique « état
    -- actuel »). Cohérent avec les KPI et avec la timeline Instagram.
    'timeline', COALESCE((
      SELECT json_agg(t) FROM (
        SELECT
          d::date as date,
          (SELECT COUNT(*) FROM qualiopi_leads l
             WHERE TRUE AND DATE(l.created_at) = d::date
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)) as leads_created,
          (SELECT COUNT(*) FROM qualiopi_leads l
             WHERE TRUE AND l.called = true
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
               AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                              WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'called' AND h.new_value = 'true'),
                            DATE(l.created_at)) = d::date) as called,
          (SELECT COUNT(*) FROM qualiopi_leads l
             WHERE TRUE AND l.status = 'to_follow_up'
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
               AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                              WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'to_follow_up'),
                            DATE(l.created_at)) = d::date) as follow_ups,
          (SELECT COUNT(*) FROM qualiopi_leads l
             WHERE TRUE AND l.status = 'to_follow_up_2'
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
               AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                              WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'to_follow_up_2'),
                            DATE(l.created_at)) = d::date) as follow_ups_2,
          (SELECT COUNT(*) FROM qualiopi_leads l
             WHERE TRUE AND l.appointment_taken = true
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
               AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                              WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'appointment_taken' AND h.new_value = 'true'),
                            DATE(l.created_at)) = d::date) as appointments,
          (SELECT COUNT(*) FROM qualiopi_leads l
             WHERE TRUE AND l.status = 'lost'
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
               AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                              WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'lost'),
                            DATE(l.created_at)) = d::date) as lost,
          (SELECT COUNT(*) FROM qualiopi_leads l
             WHERE TRUE AND l.status = 'client'
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
               AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                              WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'client'),
                            DATE(l.created_at)) = d::date) as clients
        FROM generate_series(v_start, CURRENT_DATE, '1 day') d
        ORDER BY d
      ) t
    ), '[]'::json),

    -- Activité par setter, jour par jour (aujourd'hui, J-1, J-2) + « Non assigné »
    -- (affiché seulement les jours où il a de l'activité). Même sémantique
    -- « état actuel » que la timeline.
    'by_setter_daily', COALESCE((
      SELECT json_agg(day_data) FROM (
        SELECT
          d::date AS date,
          COALESCE((
            SELECT json_agg(s) FROM (
              SELECT * FROM (
                SELECT
                  u.id                                AS setter_id,
                  u.first_name || ' ' || u.last_name  AS name,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id = u.id AND TRUE
                       AND DATE(l.created_at) = d::date) AS leads_created,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id = u.id AND TRUE AND l.called = true
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'called' AND h.new_value = 'true'),
                                    DATE(l.created_at)) = d::date) AS called,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id = u.id AND TRUE AND l.status = 'to_follow_up'
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'to_follow_up'),
                                    DATE(l.created_at)) = d::date) AS follow_ups,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id = u.id AND TRUE AND l.status = 'to_follow_up_2'
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'to_follow_up_2'),
                                    DATE(l.created_at)) = d::date) AS follow_ups_2,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id = u.id AND TRUE AND l.appointment_taken = true
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'appointment_taken' AND h.new_value = 'true'),
                                    DATE(l.created_at)) = d::date) AS appointments,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id = u.id AND TRUE AND l.quote_sent = true
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'quote_sent' AND h.new_value = 'true'),
                                    DATE(l.created_at)) = d::date) AS quotes,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id = u.id AND TRUE AND l.status = 'lost'
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'lost'),
                                    DATE(l.created_at)) = d::date) AS lost,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id = u.id AND TRUE AND l.status = 'client'
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'client'),
                                    DATE(l.created_at)) = d::date) AS clients
                FROM users u
                WHERE u.role = 'setter' AND u.is_active = true
                  AND 'qualiopi' = ANY(u.acquisition_sources)

                UNION ALL

                SELECT
                  NULL::uuid AS setter_id,
                  'Non assigné' AS name,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id IS NULL AND TRUE
                       AND DATE(l.created_at) = d::date) AS leads_created,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id IS NULL AND TRUE AND l.called = true
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'called' AND h.new_value = 'true'),
                                    DATE(l.created_at)) = d::date) AS called,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id IS NULL AND TRUE AND l.status = 'to_follow_up'
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'to_follow_up'),
                                    DATE(l.created_at)) = d::date) AS follow_ups,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id IS NULL AND TRUE AND l.status = 'to_follow_up_2'
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'to_follow_up_2'),
                                    DATE(l.created_at)) = d::date) AS follow_ups_2,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id IS NULL AND TRUE AND l.appointment_taken = true
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'appointment_taken' AND h.new_value = 'true'),
                                    DATE(l.created_at)) = d::date) AS appointments,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id IS NULL AND TRUE AND l.quote_sent = true
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'quote_sent' AND h.new_value = 'true'),
                                    DATE(l.created_at)) = d::date) AS quotes,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id IS NULL AND TRUE AND l.status = 'lost'
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'lost'),
                                    DATE(l.created_at)) = d::date) AS lost,
                  (SELECT COUNT(*) FROM qualiopi_leads l
                     WHERE l.setter_id IS NULL AND TRUE AND l.status = 'client'
                       AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM qualiopi_lead_history h
                                      WHERE h.qualiopi_lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'client'),
                                    DATE(l.created_at)) = d::date) AS clients
              ) rows
              WHERE rows.setter_id IS NOT NULL
                 OR (rows.leads_created + rows.called + rows.follow_ups + rows.follow_ups_2
                     + rows.appointments + rows.quotes + rows.lost + rows.clients) > 0
              ORDER BY clients DESC, called DESC, leads_created DESC
            ) s
          ), '[]'::json) AS setters
        FROM generate_series(CURRENT_DATE - 2, CURRENT_DATE, '1 day') d
        ORDER BY d DESC
      ) day_data
    ), '[]'::json)
  );
END;
$function$;

-- ---------- RPC classement ----------
CREATE OR REPLACE FUNCTION public.get_qualiopi_leaderboard(p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN COALESCE((
    SELECT json_agg(s) FROM (
      SELECT
        u.id, u.first_name, u.last_name,
        COUNT(l.id) as total_leads,
        COUNT(l.id) FILTER (WHERE l.called = true) as called,
        COUNT(l.id) FILTER (WHERE l.status = 'to_follow_up') as follow_ups,
        COUNT(l.id) FILTER (WHERE l.status = 'to_follow_up_2') as follow_ups_2,
        COUNT(l.id) FILTER (WHERE l.appointment_taken = true) as appointments,
        COUNT(l.id) FILTER (WHERE l.status = 'lost') as lost,
        COUNT(l.id) FILTER (WHERE l.status = 'client') as clients,
        ROUND(CASE WHEN COUNT(l.id) > 0 THEN COUNT(l.id) FILTER (WHERE l.status = 'client')::numeric / COUNT(l.id) * 100 ELSE 0 END, 1) as conversion_rate
      FROM users u
      LEFT JOIN qualiopi_leads l ON l.setter_id = u.id AND TRUE AND l.created_at >= CURRENT_DATE - p_days
      WHERE u.role = 'setter' AND u.is_active = true
        AND 'qualiopi' = ANY(u.acquisition_sources)
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY clients DESC, total_leads DESC
    ) s
  ), '[]'::json);
END;
$function$;
