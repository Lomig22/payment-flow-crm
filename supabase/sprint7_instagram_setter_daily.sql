-- ============================================================
-- Sprint 7 — Activité par setter (Instagram) au jour le jour
-- Ajoute by_setter_daily : activité par setter pour chacun des 3
-- derniers jours (aujourd'hui, J-1, J-2). Fenêtre glissante : un
-- jour sort automatiquement dès qu'il dépasse 3 jours (pas de purge
-- nécessaire, c'est juste un filtre de date recalculé à chaque appel).
-- À exécuter dans Supabase > SQL Editor (ou via psql -f)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_instagram_dashboard_stats(
  p_setter_id uuid DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql
AS $function$
DECLARE
  v_start date := CURRENT_DATE - p_days;
  v_overview json;
BEGIN
  SELECT json_build_object(
    'total_leads',          COUNT(*),
    'm1_sent',               COUNT(*) FILTER (WHERE m1_date IS NOT NULL),
    'r1',                    COUNT(*) FILTER (WHERE r1_date IS NOT NULL),
    'r2',                    COUNT(*) FILTER (WHERE r2_date IS NOT NULL),
    'reponse',               COUNT(*) FILTER (WHERE reponse_date IS NOT NULL),
    'a_relancer',            COUNT(*) FILTER (WHERE status = 'a_relancer'),
    'audit_a_envoyer',       COUNT(*) FILTER (WHERE status = 'audit_a_envoyer'),
    'audit_envoye',          COUNT(*) FILTER (WHERE audit_date IS NOT NULL),
    'rdv',                   COUNT(*) FILTER (WHERE rdv_date IS NOT NULL),
    'open_count',            COUNT(*) FILTER (WHERE a_ouvert = true),
    'open_rate',             ROUND(CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER (WHERE a_ouvert = true)::numeric / COUNT(*) * 100 ELSE 0 END, 1),
    'rdv_conversion_rate',   ROUND(CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER (WHERE rdv_date IS NOT NULL)::numeric / COUNT(*) * 100 ELSE 0 END, 1)
  ) INTO v_overview
  FROM leads
  WHERE source = 'instagram'
    AND created_at >= v_start
    AND (p_setter_id IS NULL OR setter_id = p_setter_id);

  RETURN json_build_object(
    'overview', v_overview,

    'by_status', COALESCE((
      SELECT json_object_agg(status, cnt) FROM (
        SELECT status, COUNT(*) AS cnt
        FROM leads
        WHERE source = 'instagram'
          AND created_at >= v_start
          AND (p_setter_id IS NULL OR setter_id = p_setter_id)
          AND status IN ('lead','m1','r1','r2','reponse','a_relancer','audit_a_envoyer','audit_envoye','rdv')
        GROUP BY status
      ) s
    ), '{}'::json),

    'by_niche', COALESCE((
      SELECT json_agg(n) FROM (
        SELECT COALESCE(NULLIF(niche, ''), 'Sans niche') AS niche, COUNT(*) AS count
        FROM leads
        WHERE source = 'instagram'
          AND created_at >= v_start
          AND (p_setter_id IS NULL OR setter_id = p_setter_id)
        GROUP BY 1
        ORDER BY count DESC
      ) n
    ), '[]'::json),

    'timeline', COALESCE((
      SELECT json_agg(t) FROM (
        SELECT
          d::date AS date,
          COUNT(l.id) FILTER (WHERE DATE(l.created_at) = d::date)  AS leads_created,
          COUNT(l.id) FILTER (WHERE DATE(l.m1_date)      = d::date) AS m1,
          COUNT(l.id) FILTER (WHERE DATE(l.r1_date)      = d::date) AS r1,
          COUNT(l.id) FILTER (WHERE DATE(l.r2_date)      = d::date) AS r2,
          COUNT(l.id) FILTER (WHERE DATE(l.reponse_date) = d::date) AS reponse,
          COUNT(l.id) FILTER (WHERE DATE(l.audit_date)   = d::date) AS audit_envoye,
          COUNT(l.id) FILTER (WHERE DATE(l.rdv_date)     = d::date) AS rdv
        FROM generate_series(v_start, CURRENT_DATE, '1 day') d
        LEFT JOIN leads l ON l.source = 'instagram' AND (p_setter_id IS NULL OR l.setter_id = p_setter_id)
        GROUP BY d
        ORDER BY d
      ) t
    ), '[]'::json),

    'by_setter_daily', COALESCE((
      SELECT json_agg(day_data) FROM (
        SELECT
          d::date AS date,
          COALESCE((
            SELECT json_agg(s) FROM (
              SELECT
                u.id                                AS setter_id,
                u.first_name || ' ' || u.last_name  AS name,
                COUNT(l.id) FILTER (WHERE DATE(l.m1_date)      = d::date) AS m1,
                COUNT(l.id) FILTER (WHERE DATE(l.r1_date)      = d::date) AS r1,
                COUNT(l.id) FILTER (WHERE DATE(l.r2_date)      = d::date) AS r2,
                COUNT(l.id) FILTER (WHERE DATE(l.reponse_date) = d::date) AS reponse,
                COUNT(l.id) FILTER (WHERE DATE(l.audit_date)   = d::date) AS audit_envoye,
                COUNT(l.id) FILTER (WHERE DATE(l.rdv_date)     = d::date) AS rdv
              FROM users u
              LEFT JOIN leads l ON l.setter_id = u.id AND l.source = 'instagram'
              WHERE u.role = 'setter' AND u.is_active = true
                AND 'instagram' = ANY(u.acquisition_sources)
              GROUP BY u.id, u.first_name, u.last_name
              ORDER BY rdv DESC, audit_envoye DESC, reponse DESC
            ) s
          ), '[]'::json) AS setters
        FROM generate_series(CURRENT_DATE - 2, CURRENT_DATE, '1 day') d
        ORDER BY d DESC
      ) day_data
    ), '[]'::json)
  );
END;
$function$;
