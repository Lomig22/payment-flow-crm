-- Sprint 26 — Dashboard Instagram : vision funnel (piste follow + piste DM à froid),
-- stock par statut, activité récente, détail par compte d'envoi (détection shadowban).
-- « Atteint l'étape » = date posée OU statut égal/au-delà (les anciens leads n'ont
-- pas toujours la date). Fonction dédiée : ne touche pas get_instagram_dashboard_stats.
CREATE OR REPLACE FUNCTION public.get_instagram_funnel_stats(p_setter_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
SET timezone TO 'Europe/Paris'
AS $function$
DECLARE
  v_start  date := CURRENT_DATE - p_days;
  v_result json;
BEGIN
  WITH l AS (
    SELECT id, status, ig_outreach, last_dm_account_id,
           followed_at, followed_back_at, m1_date, reponse_date, rdv_date, a_ouvert,
           (m1_date IS NOT NULL OR status IN ('m1','r1','r2','reponse','a_relancer','audit_a_envoyer','audit_envoye','rdv')) AS r_dm,
           (reponse_date IS NOT NULL OR status IN ('reponse','a_relancer','audit_a_envoyer','audit_envoye','rdv')) AS r_reply,
           (rdv_date IS NOT NULL OR status = 'rdv') AS r_rdv
    FROM leads
    WHERE source = 'instagram'
      AND (p_setter_id IS NULL OR setter_id = p_setter_id)
  ),
  l2 AS (
    SELECT *,
           (a_ouvert = true OR r_reply) AS r_open,
           (followed_at IS NOT NULL OR status IN ('followed','followed_back') OR (ig_outreach = 'follow' AND r_dm)) AS r_followed,
           (followed_back_at IS NOT NULL OR status = 'followed_back' OR (ig_outreach = 'follow' AND r_dm)) AS r_followed_back
    FROM l
  )
  SELECT json_build_object(
    'stock', COALESCE((SELECT json_object_agg(status, cnt) FROM (SELECT status, count(*) AS cnt FROM l2 GROUP BY status) s), '{}'::json),

    'funnel_follow', (SELECT json_build_object(
        'imported',      count(*),
        'followed',      count(*) FILTER (WHERE r_followed),
        'followed_back', count(*) FILTER (WHERE r_followed_back),
        'dm_sent',       count(*) FILTER (WHERE r_dm),
        'opened',        count(*) FILTER (WHERE r_dm AND r_open),
        'replied',       count(*) FILTER (WHERE r_reply),
        'rdv',           count(*) FILTER (WHERE r_rdv)
      ) FROM l2 WHERE ig_outreach = 'follow'),

    'funnel_dm', (SELECT json_build_object(
        'leads',   count(*),
        'dm_sent', count(*) FILTER (WHERE r_dm),
        'opened',  count(*) FILTER (WHERE r_dm AND r_open),
        'replied', count(*) FILTER (WHERE r_reply),
        'rdv',     count(*) FILTER (WHERE r_rdv)
      ) FROM l2 WHERE ig_outreach = 'dm'),

    'by_account', COALESCE((SELECT json_agg(a ORDER BY a.dm_sent DESC, a.follows DESC) FROM (
        SELECT sa.id AS account_id,
               COALESCE(NULLIF(sa.username, ''), sa.account_name) AS username,
               count(l2.id) FILTER (WHERE l2.r_dm)              AS dm_sent,
               count(l2.id) FILTER (WHERE l2.r_dm AND l2.r_open) AS opened,
               count(l2.id) FILTER (WHERE l2.r_reply)           AS replied,
               (SELECT count(*) FROM instagram_dm_log g WHERE g.account_id = sa.id AND g.action = 'follow') AS follows,
               count(l2.id) FILTER (WHERE l2.r_followed_back)   AS follow_backs
        FROM social_accounts sa
        LEFT JOIN l2 ON l2.last_dm_account_id = sa.id
        WHERE sa.platform = 'instagram'
        GROUP BY sa.id, sa.username, sa.account_name
      ) a), '[]'::json),

    'last7', (SELECT json_build_object(
        'follows',      count(*) FILTER (WHERE followed_at      >= now() - interval '7 days'),
        'follow_backs', count(*) FILTER (WHERE followed_back_at >= now() - interval '7 days'),
        'dm_sent',      count(*) FILTER (WHERE m1_date          >= now() - interval '7 days'),
        'replied',      count(*) FILTER (WHERE reponse_date     >= now() - interval '7 days')
      ) FROM l2),

    'timeline', COALESCE((SELECT json_agg(t ORDER BY t.date) FROM (
        SELECT d::date AS date,
               count(l2.id) FILTER (WHERE DATE(l2.followed_at)      = d::date) AS follows,
               count(l2.id) FILTER (WHERE DATE(l2.followed_back_at) = d::date) AS follow_backs,
               count(l2.id) FILTER (WHERE DATE(l2.m1_date) = d::date AND l2.ig_outreach = 'dm')     AS dm_cold,
               count(l2.id) FILTER (WHERE DATE(l2.m1_date) = d::date AND l2.ig_outreach = 'follow') AS dm_follow
        FROM generate_series(v_start, CURRENT_DATE, '1 day') d
        LEFT JOIN l2 ON true
        GROUP BY d
      ) t), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
