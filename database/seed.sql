-- ============================================================
-- Payment Flow CRM - Seed Data
-- ============================================================

-- Admin user (password: Admin123!)
INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'admin@paymentflow.fr',
   crypt('Admin123!', gen_salt('bf', 10)),
   'Alexandre', 'Admin', 'admin');

-- Setter users (password: Setter123!)
INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES
  ('00000000-0000-0000-0000-000000000002',
   'alice.martin@paymentflow.fr',
   crypt('Setter123!', gen_salt('bf', 10)),
   'Alice', 'Martin', 'setter'),
  ('00000000-0000-0000-0000-000000000003',
   'bob.dupont@paymentflow.fr',
   crypt('Setter123!', gen_salt('bf', 10)),
   'Bob', 'Dupont', 'setter'),
  ('00000000-0000-0000-0000-000000000004',
   'claire.bernard@paymentflow.fr',
   crypt('Setter123!', gen_salt('bf', 10)),
   'Claire', 'Bernard', 'setter');

-- Tags
INSERT INTO tags (id, name, color) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Urgent',    '#ef4444'),
  ('10000000-0000-0000-0000-000000000002', 'VIP',       '#f59e0b'),
  ('10000000-0000-0000-0000-000000000003', 'Rappel',    '#3b82f6'),
  ('10000000-0000-0000-0000-000000000004', 'Qualifié',  '#10b981'),
  ('10000000-0000-0000-0000-000000000005', 'Cold',      '#6b7280');

-- Sample leads (mix of statuses, qualities, setters)
INSERT INTO leads (first_name, last_name, company, phone, email, location, called, action_in_progress, lead_quality, need_identified, setter_id, appointment_taken, appointment_honored, quote_sent, r2_planned, r3_planned, status) VALUES
  ('Jean',      'Moreau',    'TechCorp SA',         '0612345678', 'jean.moreau@techcorp.fr',     'Paris 75001',   true,  'follow_up',   'hot',  'Solution de paiement pour e-commerce',          '00000000-0000-0000-0000-000000000002', true,  true,  true,  true,  false, 'client'),
  ('Sophie',    'Laurent',   'InnoVert SAS',        '0623456789', 'slaurent@innovert.fr',        'Lyon 69002',    true,  'negotiation', 'hot',  'Intégration API paiement',                      '00000000-0000-0000-0000-000000000002', true,  true,  true,  false, false, 'in_progress'),
  ('Marc',      'Petit',     'Boulangerie Petit',   '0634567890', 'marc@boulangeriepetit.fr',    'Marseille',     true,  'callback',    'warm', 'Terminal de paiement boutique',                 '00000000-0000-0000-0000-000000000003', true,  false, false, false, false, 'in_progress'),
  ('Isabelle',  'Durand',    'Cabinet IDC',         '0645678901', 'idurand@cabinetIDC.fr',       'Bordeaux',      false, 'to_call',     'cold', NULL,                                            '00000000-0000-0000-0000-000000000003', false, false, false, false, false, 'in_progress'),
  ('Thomas',    'Leroy',     'Leroy Distribution',  '0656789012', 'thomas@leroydist.fr',         'Nantes',        true,  'follow_up',   'hot',  'Paiement en ligne multi-devises',               '00000000-0000-0000-0000-000000000002', true,  true,  true,  true,  true,  'client'),
  ('Marie',     'Simon',     'SimonBio SARL',       '0667890123', 'msimon@simonbio.fr',          'Toulouse',      true,  'follow_up',   'warm', 'Caisse enregistreuse connectée',                '00000000-0000-0000-0000-000000000004', false, false, false, false, false, 'lost'),
  ('Pierre',    'Dubois',    'Dubois & Fils',       '0678901234', 'pierre@dubois-fils.fr',       'Strasbourg',    false, 'to_call',     NULL,   NULL,                                            '00000000-0000-0000-0000-000000000004', false, false, false, false, false, 'in_progress'),
  ('Camille',   'Roux',      'Roux Consulting',     '0689012345', 'croux@rouxconsulting.com',    'Lille',         true,  'negotiation', 'hot',  'Automatisation facturation et paiement',        '00000000-0000-0000-0000-000000000002', true,  true,  true,  true,  false, 'in_progress'),
  ('Nicolas',   'Girard',    'GirardTech',          '0690123456', 'ngirard@girardtech.io',       'Rennes',        true,  'callback',    'warm', 'Passerelle paiement B2B',                       '00000000-0000-0000-0000-000000000003', true,  false, false, false, false, 'in_progress'),
  ('Julie',     'Bonnet',    'Boutique Julie',      '0601234567', 'julie@boutiquejulie.fr',      'Nice',          false, 'to_call',     'cold', NULL,                                            '00000000-0000-0000-0000-000000000004', false, false, false, false, false, 'in_progress'),
  ('Antoine',   'Mercier',   'Mercier Immobilier',  '0611223344', 'amercier@mercier-immo.fr',   'Montpellier',   true,  'follow_up',   'warm', 'Paiement loyers en ligne',                      '00000000-0000-0000-0000-000000000002', true,  true,  false, false, false, 'in_progress'),
  ('Lucie',     'Faure',     'Faure & Associés',    '0622334455', 'lfaure@faureasso.fr',         'Grenoble',      true,  'no_action',   'cold', 'Budget limité cette année',                     '00000000-0000-0000-0000-000000000003', false, false, false, false, false, 'lost'),
  ('Maxime',    'Garnier',   'Garnier Events',      '0633445566', 'mgarnier@garnierevents.fr',   'Nîmes',         false, 'to_call',     NULL,   NULL,                                            '00000000-0000-0000-0000-000000000004', false, false, false, false, false, 'in_progress'),
  ('Emma',      'Chevalier', 'Chevalier Design',    '0644556677', 'emma@chevalierdesign.fr',     'Dijon',         true,  'follow_up',   'hot',  'Paiement abonnements créatifs',                 '00000000-0000-0000-0000-000000000002', true,  true,  true,  false, false, 'client'),
  ('Hugo',      'Morel',     'Morel Industries',    '0655667788', 'hmorel@morel-industries.fr',  'Clermont-Ferrand', true, 'negotiation', 'hot', 'Solution paiement usine & B2B lourd',          '00000000-0000-0000-0000-000000000003', true,  true,  true,  true,  false, 'in_progress'),
  ('Clara',     'Robin',     'Robin Shop',          '0666778899', 'clara@robinshop.fr',          'Le Havre',      false, 'to_call',     'cold', NULL,                                            '00000000-0000-0000-0000-000000000004', false, false, false, false, false, 'in_progress'),
  ('Julien',    'Blanc',     'Blanc Restauration',  '0677889900', 'jblanc@blancrestaur.fr',     'Toulon',        true,  'callback',    'warm', 'Paiement sans contact restaurant',              '00000000-0000-0000-0000-000000000002', true,  false, false, false, false, 'in_progress'),
  ('Manon',     'Guerin',    'Guerin Pharma',       '0688990011', 'mguerin@guerinpharma.fr',    'Angers',        true,  'follow_up',   'hot',  'Paiement officine et abonnements patient',      '00000000-0000-0000-0000-000000000003', true,  true,  true,  true,  true,  'client'),
  ('Romain',    'Clement',   'Clement Auto',        '0699001122', 'rclement@clementauto.fr',    'Limoges',       false, 'to_call',     NULL,   NULL,                                            '00000000-0000-0000-0000-000000000004', false, false, false, false, false, 'in_progress'),
  ('Inès',      'Prevot',    'Prevot Beauté',       '0600112233', 'ines@prevotbeaute.fr',        'Reims',         true,  'follow_up',   'warm', 'Paiement en ligne institut de beauté',          '00000000-0000-0000-0000-000000000002', true,  true,  false, false, false, 'in_progress');

-- Lead history (initial creation logs)
INSERT INTO lead_history (lead_id, user_id, action_note)
SELECT id, setter_id, 'Lead créé' FROM leads;
