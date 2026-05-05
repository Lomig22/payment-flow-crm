export type UserRole    = 'admin' | 'setter';
export type LeadQuality = 'hot' | 'warm' | 'cold';
export type LeadStatus  = 'lost' | 'in_progress' | 'client';
export type ActionType  = 'to_call' | 'callback' | 'follow_up' | 'negotiation' | 'no_action';

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
  notes?:              string;
  tags?:               Tag[];
  history?:            LeadHistory[];
  created_at:          string;
  updated_at:          string;
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
  search?:    string;
  page?:      number;
  limit?:     number;
  sort?:      string;
  order?:     'asc' | 'desc';
}
