-- ============================================================
-- Sprint 8 — Activité par setter (Cold Call) au jour le jour
-- Ajoute by_setter_daily à get_dashboard_stats : activité par setter
-- pour chacun des 3 derniers jours (aujourd'hui, J-1, J-2), à l'image
-- du dashboard Instagram. Fenêtre glissante recalculée à chaque appel.
--
-- Les leads Cold Call n'ont pas de colonnes de dates par action (called,
-- appointment_taken, ...) : on dérive donc le JOUR de chaque action depuis
-- lead_history, qui horodate chaque changement de champ.
--
-- Sémantique « état actuel » : une action ne compte que si le lead est
-- TOUJOURS dans cet état (l.called/appointment_taken/quote_sent = true,
-- status = 'client'), attribuée au jour de la DERNIÈRE transition vers cet
-- état (MAX de lead_history). Une action annulée ensuite ne compte plus.
-- Toutes les sections (KPI overview, timeline, activité par setter) se
-- réconcilient ainsi sur les mêmes leads. Repli sur la date de création
-- quand aucune trace d'historique n'existe (lead créé déjà dans cet état).
-- À exécuter dans Supabase > SQL Editor (ou via psql -f)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_setter_id uuid DEFAULT NULL,
  p_days integer DEFAULT 30
)
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
    'by_status', json_build_object(
      'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
      'client', COUNT(*) FILTER (WHERE status = 'client'),
      'lost', COUNT(*) FILTER (WHERE status = 'lost')
    )
  ) INTO v_result
  FROM leads
  WHERE source = 'cold_call'
    AND created_at >= v_start
    AND (p_setter_id IS NULL OR setter_id = p_setter_id);

  RETURN json_build_object(
    'overview',  v_result->'overview',
    'by_quality', v_result->'by_quality',
    'by_status', v_result->'by_status',

    'by_setter', COALESCE((
      SELECT json_agg(s) FROM (
        SELECT
          u.id as setter_id,
          u.first_name || ' ' || u.last_name as name,
          COUNT(l.id) as total,
          COUNT(l.id) FILTER (WHERE l.called = true) as called,
          COUNT(l.id) FILTER (WHERE l.status = 'client') as clients,
          ROUND(CASE WHEN COUNT(l.id) > 0 THEN COUNT(l.id) FILTER (WHERE l.status = 'client')::numeric / COUNT(l.id) * 100 ELSE 0 END, 1) as conversion_rate
        FROM users u
        LEFT JOIN leads l ON l.setter_id = u.id AND l.source = 'cold_call' AND l.created_at >= v_start
        WHERE u.role = 'setter' AND u.is_active = true
          AND 'cold_call' = ANY(u.acquisition_sources)
        GROUP BY u.id, u.first_name, u.last_name
        ORDER BY clients DESC
      ) s
    ), '[]'::json),

    -- Timeline : leads_created par date de création ; clients & appointments
    -- attribués au jour RÉEL de l'action (dernière transition via lead_history),
    -- et seulement si le lead est toujours dans cet état (sémantique « état
    -- actuel »). Cohérent avec les KPI et avec la timeline Instagram.
    'timeline', COALESCE((
      SELECT json_agg(t) FROM (
        SELECT
          d::date as date,
          (SELECT COUNT(*) FROM leads l
             WHERE l.source = 'cold_call' AND DATE(l.created_at) = d::date
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)) as leads_created,
          (SELECT COUNT(*) FROM leads l
             WHERE l.source = 'cold_call' AND l.status = 'client'
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
               AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM lead_history h
                              WHERE h.lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'client'),
                            DATE(l.created_at)) = d::date) as clients,
          (SELECT COUNT(*) FROM leads l
             WHERE l.source = 'cold_call' AND l.appointment_taken = true
               AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
               AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM lead_history h
                              WHERE h.lead_id = l.id AND h.field_changed = 'appointment_taken' AND h.new_value = 'true'),
                            DATE(l.created_at)) = d::date) as appointments
        FROM generate_series(v_start, CURRENT_DATE, '1 day') d
        ORDER BY d
      ) t
    ), '[]'::json),

    -- Activité par setter, jour par jour (aujourd'hui, J-1, J-2).
    -- Même sémantique « état actuel » que la timeline : on compte un lead
    -- pour le jour de sa dernière transition vers l'état, s'il y est toujours.
    'by_setter_daily', COALESCE((
      SELECT json_agg(day_data) FROM (
        SELECT
          d::date AS date,
          COALESCE((
            SELECT json_agg(s) FROM (
              SELECT
                u.id                                AS setter_id,
                u.first_name || ' ' || u.last_name  AS name,
                (SELECT COUNT(*) FROM leads l
                   WHERE l.setter_id = u.id AND l.source = 'cold_call'
                     AND DATE(l.created_at) = d::date) AS leads_created,
                (SELECT COUNT(*) FROM leads l
                   WHERE l.setter_id = u.id AND l.source = 'cold_call' AND l.called = true
                     AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM lead_history h
                                    WHERE h.lead_id = l.id AND h.field_changed = 'called' AND h.new_value = 'true'),
                                  DATE(l.created_at)) = d::date) AS called,
                (SELECT COUNT(*) FROM leads l
                   WHERE l.setter_id = u.id AND l.source = 'cold_call' AND l.appointment_taken = true
                     AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM lead_history h
                                    WHERE h.lead_id = l.id AND h.field_changed = 'appointment_taken' AND h.new_value = 'true'),
                                  DATE(l.created_at)) = d::date) AS appointments,
                (SELECT COUNT(*) FROM leads l
                   WHERE l.setter_id = u.id AND l.source = 'cold_call' AND l.quote_sent = true
                     AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM lead_history h
                                    WHERE h.lead_id = l.id AND h.field_changed = 'quote_sent' AND h.new_value = 'true'),
                                  DATE(l.created_at)) = d::date) AS quotes,
                (SELECT COUNT(*) FROM leads l
                   WHERE l.setter_id = u.id AND l.source = 'cold_call' AND l.status = 'client'
                     AND COALESCE((SELECT DATE(MAX(h.created_at)) FROM lead_history h
                                    WHERE h.lead_id = l.id AND h.field_changed = 'status' AND h.new_value = 'client'),
                                  DATE(l.created_at)) = d::date) AS clients
              FROM users u
              WHERE u.role = 'setter' AND u.is_active = true
                AND 'cold_call' = ANY(u.acquisition_sources)
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
