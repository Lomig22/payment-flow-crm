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
  id:         string;
  email:      string;
  first_name: string;
  last_name:  string;
  role:       UserRole;
  is_active:  boolean;
  avatar_url?: string;
  created_at: string;
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
  // Instagram-specific
  instagram_username?: string;
  instagram_url?:      string;
  a_ouvert?:           boolean;
  niche?:              string;
  bio?:                string;
  followers_count?:    number;
  ig_score?:           number;
  // Instagram funnel dates
  m1_date?:            string;
  r1_date?:            string;
  r2_date?:            string;
  reponse_date?:       string;
  a_relancer_date?:    string;
  audit_date?:         string;
  rdv_date?:           string;
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
  by_status:  { in_progress: number; client: number; lost: number };
  by_setter:  Array<{
    setter_id:       string;
    name:            string;
    total:           number;
    called:          number;
    clients:         number;
    conversion_rate: number;
  }>;
  timeline: Array<{
    date:           string;
    leads_created:  number;
    clients:        number;
    appointments:   number;
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
  setter_id?: string;
  status?:    LeadStatus | '';
  quality?:   LeadQuality | '';
  source?:    LeadSource | '';
  search?:    string;
  page?:      number;
  limit?:     number;
  sort?:      string;
  order?:     'asc' | 'desc';
}
