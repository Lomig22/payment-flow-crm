export type UserRole    = 'admin' | 'setter';
export type LeadQuality = 'hot' | 'warm' | 'cold';
// Cold call funnel
export type ColdCallStatus = 'in_progress' | 'to_follow_up' | 'to_follow_up_2' | 'appointment' | 'r2' | 'client' | 'lost';
// Instagram funnel (DM)
export type InstagramStatus = 'lead' | 'm1' | 'r1' | 'r2' | 'reponse' | 'a_relancer' | 'audit_a_envoyer' | 'audit_envoye' | 'rdv';
export type LeadStatus = ColdCallStatus | InstagramStatus;
export type ActionType  = 'to_call' | 'callback' | 'follow_up' | 'negotiation' | 'no_action';
export type LeadSource  = 'instagram' | 'facebook' | 'cold_call';

export interface User {
  id:                   string;
  email:                string;
  first_name:           string;
  last_name:            string;
  role:                 UserRole;
  is_active:            boolean;
  avatar_url?:          string;
  created_at:           string;
  acquisition_sources?: string[];
}

export interface Tag {
  id:         string;
  name:       string;
  color:      string;
  lead_count?: number;
}

export interface LeadHistory {
  id:            string;
  lead_id:       string;
  user_id?:      string;
  first_name?:   string;
  last_name?:    string;
  field_changed?: string;
  old_value?:    string;
  new_value?:    string;
  action_note?:  string;
  created_at:    string;
}

export interface Lead {
  id:                  string;
  first_name:          string;
  last_name:           string;
  company?:            string;
  phone?:              string;
  email?:              string;
  location?:           string;
  called:              boolean;
  action_in_progress:  ActionType;
  lead_quality?:       LeadQuality;
  need_identified?:    string;
  setter_id?:          string;
  setter?:             Pick<User, 'id' | 'first_name' | 'last_name' | 'email'> | null;
  appointment_taken:   boolean;
  appointment_honored: boolean;
  quote_sent:          boolean;
  r2_planned:          boolean;
  r3_planned:          boolean;
  status:              LeadStatus;
  source?:             LeadSource | null;
  notes?:              string;
  tags?:               Tag[];
  history?:            LeadHistory[];
  created_at:          string;
  updated_at:          string;
  // Instagram/Facebook-specific
  instagram_username?: string;
  instagram_url?:      string;
  a_ouvert?:           boolean;
  niche?:              string;
  bio?:                string;
  followers_count?:    number;
  ig_score?:           number;
  // RDV outcome (Sprint 3)
  rdv_outcome?:        'present' | 'vendu' | 'no_show' | 'pas_qualifie';
  // Mail-passerelle Opération Show-Up (Sprint 14)
  confirmation_email_sent_at?: string | null;
  confirmation_received_at?:   string | null;
  // Instagram/Facebook funnel dates
  m1_date?:            string;
  r1_date?:            string;
  r2_date?:            string;
  reponse_date?:       string;
  a_relancer_date?:    string;
  audit_date?:         string;
  rdv_date?:           string;
}

// ─── Qualiopi (table dédiée qualiopi_leads) ───
export type QualiopiStatus = ColdCallStatus;

export interface QualiopiLead {
  id:                  string;
  company:             string;   // nom_entreprise
  dirigeant?:          string;
  activite?:           string;
  phone?:              string;
  email?:              string;
  city?:               string;   // ville
  has_website:         boolean;
  called:              boolean;
  lead_quality?:       LeadQuality;
  need_identified?:    string;
  setter_id?:          string;
  setter?:             Pick<User, 'id' | 'first_name' | 'last_name' | 'email'> | null;
  appointment_taken:   boolean;
  appointment_honored: boolean;
  quote_sent:          boolean;
  status:              QualiopiStatus;
  notes?:              string;
  import_batch_id?:    string;
  history?:            LeadHistory[];
  created_at:          string;
  updated_at:          string;
}

export interface QualiopiLeadsFilters {
  setter_id?:  string;
  status?:     QualiopiStatus | '';
  quality?:    LeadQuality | '';
  search?:     string;
  page?:       number;
  limit?:      number;
  sort?:       string;
  order?:      'asc' | 'desc';
  count_only?: boolean;
}

export interface DashboardStats {
  overview: {
    total_leads:           number;
    leads_called:          number;
    appointments_taken:    number;
    appointments_honored:  number;
    quotes_sent:           number;
    clients_signed:        number;
    conversion_rate:       number;
    no_show_rate:          number;
  };
  by_quality: { hot: number; warm: number; cold: number; unqualified: number };
  by_status:  Record<string, number>;
  by_setter:  Array<{
    setter_id:       string | null;
    name:            string;
    total:           number;
    called:          number;
    follow_ups:      number;
    follow_ups_2:    number;
    appointments:    number;
    lost:            number;
    clients:         number;
    conversion_rate: number;
  }>;
  by_setter_daily: Array<{
    date:    string;
    setters: Array<{
      setter_id:      string | null;
      name:           string;
      leads_created:  number;
      called:         number;
      follow_ups:     number;
      follow_ups_2:   number;
      appointments:   number;
      quotes:         number;
      lost:           number;
      clients:        number;
    }>;
  }>;
  timeline: Array<{
    date:           string;
    leads_created:  number;
    called:         number;
    follow_ups:     number;
    follow_ups_2:   number;
    appointments:   number;
    lost:           number;
    clients:        number;
  }>;
}

export interface ColdCallPerformance {
  stats: {
    total_leads:          number;
    leads_called:         number;
    follow_ups:           number;
    follow_ups_2:         number;
    appointments_taken:   number;
    appointments_honored: number;
    quotes_sent:          number;
    clients_signed:       number;
    lost:                 number;
    hot_leads:            number;
    warm_leads:           number;
    cold_leads:           number;
    conversion_rate:      number;
    no_show_rate:         number;
  };
  monthly: Array<{ month: string; total: number; clients: number; appointments: number }>;
}

export interface InstagramPerformance {
  stats: {
    total_leads:         number;
    m1_sent:             number;
    r1:                  number;
    r2:                  number;
    reponse:             number;
    audit_envoye:        number;
    rdv:                 number;
    open_count:          number;
    open_rate:           number;
    rdv_conversion_rate: number;
  };
  monthly: Array<{ month: string; total: number; rdv: number }>;
}

export interface UserPerformance {
  cold_call: ColdCallPerformance;
  instagram: InstagramPerformance;
}

export interface InstagramDashboardStats {
  overview: {
    total_leads:         number;
    m1_sent:              number;
    r1:                   number;
    r2:                   number;
    reponse:              number;
    a_relancer:           number;
    audit_a_envoyer:      number;
    audit_envoye:         number;
    rdv:                  number;
    open_count:           number;
    open_rate:            number;
    rdv_conversion_rate:  number;
  };
  by_status: Record<string, number>;
  by_niche:  Array<{ niche: string; count: number }>;
  by_setter_daily: Array<{
    date:    string;
    setters: Array<{
      setter_id:     string;
      name:          string;
      m1:            number;
      r1:            number;
      r2:            number;
      reponse:       number;
      audit_envoye:  number;
      rdv:           number;
    }>;
  }>;
  timeline: Array<{
    date:           string;
    leads_created:  number;
    m1:             number;
    r1:             number;
    r2:             number;
    reponse:        number;
    audit_envoye:   number;
    rdv:            number;
  }>;
}

export interface ConversationMember {
  user_id: string;
  users: { id: string; first_name: string; last_name: string } | null;
}

export interface Conversation {
  id:          string;
  name:        string | null;
  is_group:    boolean;
  updated_at:  string;
  last_read_at: string | null;
  unread_count: number;
  last_message: {
    content:    string;
    created_at: string;
    sender_id:  string;
  } | null;
  conversation_members: ConversationMember[];
}

export interface Message {
  id:              string;
  conversation_id: string;
  sender_id:       string;
  content:         string;
  created_at:      string;
  users: { id: string; first_name: string; last_name: string } | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
  };
}

export interface LeadsFilters {
  setter_id?:          string;
  status?:             LeadStatus | '';
  quality?:            LeadQuality | '';
  source?:             LeadSource | '';
  search?:             string;
  page?:               number;
  limit?:              number;
  sort?:               string;
  order?:              'asc' | 'desc';
  // Instagram/Facebook-specific
  niche?:              string;
  a_ouvert?:           string;
  instagram_username?: string;
  // Utility
  count_only?:         boolean;
}
