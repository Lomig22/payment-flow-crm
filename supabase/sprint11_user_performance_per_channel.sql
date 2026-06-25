-- ============================================================
-- Sprint 11 — Stats membre par canal (page Équipe → « Stats »)
--   Les cold callers et les setters Instagram n'ont pas les mêmes métriques.
--   get_user_performance renvoie désormais DEUX blocs distincts, chacun
--   restreint à sa source :
--     • cold_call : appelés, relances, relances 2, RDV, devis, perdus,
--       clients, qualité, conversion, no-show + évolution mensuelle.
--     • instagram : M1, R1, R2, réponses, audit envoyé, RDV, ouvertures,
--       taux d'ouverture, taux de conversion RDV + évolution mensuelle.
--   La fenêtre p_days s'applique aux stats ; monthly = 6 derniers mois.
-- À exécuter dans Supabase > SQL Editor (ou via psql -f)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_performance(p_user_id uuid, p_days integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
AS $function$
DECLARE
  v_start date := CURRENT_DATE - p_days;
BEGIN
  RETURN json_build_object(

    -- ─────────────── COLD CALL ───────────────
    'cold_call', json_build_object(
      'stats', (SELECT json_build_object(
        'total_leads',          COUNT(*),
        'leads_called',         COUNT(*) FILTER (WHERE called = true),
        'follow_ups',           COUNT(*) FILTER (WHERE status = 'to_follow_up'),
        'follow_ups_2',         COUNT(*) FILTER (WHERE status = 'to_follow_up_2'),
        'appointments_taken',   COUNT(*) FILTER (WHERE appointment_taken = true),
        'appointments_honored', COUNT(*) FILTER (WHERE appointment_honored = true),
        'quotes_sent',          COUNT(*) FILTER (WHERE quote_sent = true),
        'clients_signed',       COUNT(*) FILTER (WHERE status = 'client'),
        'lost',                 COUNT(*) FILTER (WHERE status = 'lost'),
        'hot_leads',            COUNT(*) FILTER (WHERE lead_quality = 'hot'),
        'warm_leads',           COUNT(*) FILTER (WHERE lead_quality = 'warm'),
        'cold_leads',           COUNT(*) FILTER (WHERE lead_quality = 'cold'),
        'conversion_rate',      ROUND(CASE WHEN COUNT(*) > 0
                                  THEN COUNT(*) FILTER (WHERE status = 'client')::numeric / COUNT(*) * 100
                                  ELSE 0 END, 1),
        'no_show_rate',         ROUND(CASE WHEN COUNT(*) FILTER (WHERE appointment_taken = true) > 0
                                  THEN (COUNT(*) FILTER (WHERE appointment_taken = true) - COUNT(*) FILTER (WHERE appointment_honored = true))::numeric
                                       / COUNT(*) FILTER (WHERE appointment_taken = true) * 100
                                  ELSE 0 END, 1)
      ) FROM leads WHERE setter_id = p_user_id AND source = 'cold_call' AND created_at >= v_start),

      'monthly', COALESCE((SELECT json_agg(m) FROM (
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')  as month,
          COUNT(*)                                             as total,
          COUNT(*) FILTER (WHERE status = 'client')            as clients,
          COUNT(*) FILTER (WHERE appointment_taken = true)     as appointments
        FROM leads
        WHERE setter_id = p_user_id AND source = 'cold_call'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at) DESC
        LIMIT 6
      ) m), '[]'::json)
    ),

    -- ─────────────── INSTAGRAM ───────────────
    'instagram', json_build_object(
      'stats', (SELECT json_build_object(
        'total_leads',         COUNT(*),
        'm1_sent',             COUNT(*) FILTER (WHERE m1_date IS NOT NULL),
        'r1',                  COUNT(*) FILTER (WHERE r1_date IS NOT NULL),
        'r2',                  COUNT(*) FILTER (WHERE r2_date IS NOT NULL),
        'reponse',             COUNT(*) FILTER (WHERE reponse_date IS NOT NULL),
        'audit_envoye',        COUNT(*) FILTER (WHERE audit_date IS NOT NULL),
        'rdv',                 COUNT(*) FILTER (WHERE rdv_date IS NOT NULL),
        'open_count',          COUNT(*) FILTER (WHERE a_ouvert = true),
        'open_rate',           ROUND(CASE WHEN COUNT(*) > 0
                                 THEN COUNT(*) FILTER (WHERE a_ouvert = true)::numeric / COUNT(*) * 100
                                 ELSE 0 END, 1),
        'rdv_conversion_rate', ROUND(CASE WHEN COUNT(*) > 0
                                 THEN COUNT(*) FILTER (WHERE rdv_date IS NOT NULL)::numeric / COUNT(*) * 100
                                 ELSE 0 END, 1)
      ) FROM leads WHERE setter_id = p_user_id AND source = 'instagram' AND created_at >= v_start),

      'monthly', COALESCE((SELECT json_agg(m) FROM (
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')  as month,
          COUNT(*)                                             as total,
          COUNT(*) FILTER (WHERE rdv_date IS NOT NULL)         as rdv
        FROM leads
        WHERE setter_id = p_user_id AND source = 'instagram'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at) DESC
        LIMIT 6
      ) m), '[]'::json)
    )
  );
END;
$function$;
