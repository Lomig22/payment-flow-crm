import axios from 'axios';
import type { Lead, User, Tag, LeadsFilters, QualiopiLead, QualiopiLeadsFilters, LinkedinStatus } from '@/types';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('pf_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('pf_token');
      localStorage.removeItem('pf_auth'); // clé Zustand persist correcte
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

export const authApi = {
  login:          (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  me:             () => api.get<User>('/auth/me'),
  logout:         () => api.post('/auth/logout'),
  changePassword: (old_password: string, new_password: string) =>
    api.put('/auth/change-password', { old_password, new_password }),
};

// Activité d'envoi Instagram du jour, par compte (sécurités de cadence)
export interface InstagramAccountActivity {
  dm_today: number; dm_hour: number; last_dm_at: string | null; follows_today: number;
  recent_variants: string[]; paused_until: string | null; pause_reason: string | null;
}
export interface IgLimits {
  dm_per_day: number; follows_per_day: number; dm_per_hour: number; dm_interval_sec: number;
  suspended_until: string | null; suspended: boolean;
}
export interface InstagramSendStats {
  limits?: IgLimits;   // 0 = pas de limite
  today: Record<string, number>;
  follows: Record<string, number>;
  accounts: Record<string, InstagramAccountActivity>;
}

export const leadsApi = {
  getAll:   (params?: LeadsFilters) => api.get('/leads', { params }),
  getOne:   (id: string) => api.get<Lead>(`/leads/${id}`),
  create:   (data: Partial<Lead>) => api.post<Lead>('/leads', data),
  update:   (id: string, data: Partial<Lead>) => api.put<Lead>(`/leads/${id}`, data),
  delete:      (id: string) => api.delete(`/leads/${id}`),
  bulkDelete:  (ids: string[]) => api.post('/leads/bulk-delete', { ids }),
  bulkStatus:  (ids: string[], status: string) => api.patch('/leads/bulk-status', { ids, status }),
  bulkSource:  (ids: string[], source: string) => api.patch('/leads/bulk-source', { ids, source }),
  import:   (formData: FormData) =>
    api.post('/leads/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  assign:   (leadIds: string[], setterId: string) =>
    api.post('/leads/assign', { lead_ids: leadIds, setter_id: setterId }),
  duplicates: (source?: string) => api.get<{ count: number; groups: { field: string; value: string; leads: { id: string; first_name: string; last_name: string }[] }[] }>('/leads/duplicates', { params: source ? { source } : undefined }),
  sendConfirmation: (id: string, data: { email: string; rdv_date: string }) =>
    api.post<{ ok: boolean; sent_at: string }>(`/leads/${id}/send-confirmation`, data),
  niches:   (source?: string) => api.get<string[]>('/leads/niches', { params: source ? { source } : undefined }),
  regions:  (source?: string) => api.get<string[]>('/leads/regions', { params: source ? { source } : undefined }),
  dmClick:  (id: string, accountId: string | null, variant?: string) =>
    api.post<{ lead: Lead; advanced: boolean }>(`/leads/${id}/dm-click`, { account_id: accountId, variant }),
  followClick: (id: string, accountId: string | null) =>
    api.post<{ lead: Lead; counted: boolean; today?: number }>(`/leads/${id}/follow-click`, { account_id: accountId }),
  dmStats:  () => api.get<InstagramSendStats>('/instagram/dm-stats'),
  limits:      () => api.get<IgLimits>('/instagram/limits'),
  saveLimits:  (data: Partial<IgLimits> & { suspend?: 'today' | 'off' }) => api.put<IgLimits>('/instagram/limits', data),
};

// Contenu Instagram inbound (publications, objectifs, stats)
export type ContentFormat = 'reel' | 'story' | 'post' | 'carousel';

export interface IgContentItem {
  id: string; format: ContentFormat; permalink: string | null; caption: string | null;
  thumbnail_url: string | null; published_at: string; day: string; leads: number;
  views: number | null; reach: number | null; likes: number | null; comments: number | null;
  shares: number | null; saved: number | null; replies: number | null;
  profile_visits: number | null; follows: number | null; total_interactions: number | null;
  avg_watch_time_ms: number | null; metrics_updated_at: string | null;
}
export interface ContentDay {
  day: string; reel: number; story: number; post: number; carousel: number; views: number; leads: number;
}
export interface IgAccountDay {
  day: string; views: number | null; reach: number | null; profile_views: number | null;
  accounts_engaged: number | null; total_interactions: number | null;
  website_clicks: number | null; followers_total: number | null;
}
export interface ContentOverview {
  account: string;
  accounts: string[];
  sync: { last_sync_at: string | null; last_sync_error: string | null; token_expires_at: string | null } | null;
  targets: Partial<Record<ContentFormat, number>>;
  today: ContentDay;
  history: ContentDay[];
  account_daily: IgAccountDay[];
  content: IgContentItem[];
  inbound_leads: number;
}

export interface ContentOption { id: string; format: ContentFormat; published_at: string; views: number | null; label: string }

export interface PostingStatus {
  account: string; last_sync_at: string | null; last_post_at: string | null; last_story_at: string | null;
  today: { posts: number; stories: number }; targets: { reel: number; story: number };
  profile_share: { id: string; title: string; published_at: string; share_url: string }[];
}

export const contentApi = {
  postingStatus: () => api.get<PostingStatus>('/instagram/posting-status'),
  options:   () => api.get<ContentOption[]>('/instagram/content/options'),
  overview:  (account?: string) =>
    api.get<ContentOverview>('/instagram/content', { params: account ? { account } : {} }),
  sync:      () => api.post<{ account: string; media: number; metrics: number; errors: string[] }[]>('/instagram/content/sync'),
  setTarget: (account_username: string, format: ContentFormat, per_day: number) =>
    api.put('/instagram/content/targets', { account_username, format, per_day }),
};

// Captation inbound (phase 4)
export interface InboundOverview {
  account: string;
  settings: { keywords: string[]; auto_reply_text: string | null };
  comments: {
    id: string; username: string | null; text: string | null; commented_at: string | null; keyword: string | null;
    lead_id: string | null; replied_at: string | null; reply_error: string | null;
    ig_content: { permalink: string | null; caption: string | null } | null;
  }[];
  conversations: {
    id: string; participant_username: string | null; channel: 'dm_inbound' | 'story_reply';
    first_message_at: string | null; lead_id: string | null;
  }[];
}

export const inboundApi = {
  overview:     () => api.get<InboundOverview>('/instagram/inbound'),
  saveSettings: (keywords: string[], auto_reply_text: string | null) =>
    api.put('/instagram/inbound', { keywords, auto_reply_text }),
};

// File de publication Instagram (phase 3)
export type QueueStatus = 'uploading' | 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
export interface CleanReport {
  removed_tags: Record<string, string>; removed_streams: string[];
  hashes_before: string[]; hashes_after: string[]; lossless: boolean;
  end_card?: boolean; audio?: AudioAnalysis; voiceover?: VoiceoverState;
}
export interface QueueItem {
  id: string; account_username: string; format: 'reel' | 'story'; caption: string | null;
  caption_ai: { hashtags: string[]; place_guess: string | null; subject: string } | null;
  caption_source: 'manual' | 'ai' | 'ai_edited' | null;
  media_url: string | null; cover_url: string | null;
  crosspost: Partial<Record<'facebook' | 'youtube' | 'tiktok', { status: 'pending' | 'done' | 'failed'; url?: string; error?: string; warning?: string }>>;
  status: QueueStatus; scheduled_at: string | null; file_name: string | null; file_size: number | null;
  clean_report: CleanReport | null; lossless: boolean | null; permalink: string | null;
  published_at: string | null; error: string | null; attempts: number; created_at: string;
}

export interface PublishingSettings { auto_schedule: boolean; reel_slots: number[]; filler_slots: number[] }

// Voix off (src/lib/voiceover.ts), rangée dans clean_report
export type VoIntention = 'CHOC' | 'GRAVE' | 'SUSPENSE' | 'ENERGIQUE' | 'INSISTANCE' | 'CONFIDENCE' | 'CONCLUSION';
export interface VoSegment { text: string; intention: VoIntention; start?: number; end?: number }
export interface VoTake { text: string; intention: VoIntention; attempts: number; rewritten: boolean; issues: string[]; rate: number }
export interface VoiceoverState {
  status: 'script' | 'voicing' | 'voiced' | 'rendering' | 'done' | 'verifying' | 'error' | 'skipped';
  hook?: string; subject?: string; segments: VoSegment[]; annotated?: string; model?: string; takes?: VoTake[];
  verify?: { ok: boolean; extra: string[]; transcript: string; at: string } | null;
  updated_at: string; rendered_at?: string; error?: string;
}
export interface AudioAnalysis { voice: boolean; language: string | null; kind: string; excerpt: string | null; foreign_voice: boolean }

export const queueApi = {
  settings:     (account?: string) => api.get<PublishingSettings>('/instagram/publishing-settings', { params: account ? { account } : {} }),
  scheduleDrafts: (account?: string) => api.post<{ scheduled: number; blocked: { file_name: string | null; reason: string }[]; no_caption: number }>('/instagram/queue/schedule-drafts', null, { params: account ? { account } : {} }),
  platforms:    () => api.get<Record<'facebook' | 'youtube' | 'tiktok', { connected: boolean; name: string | null; since: string | null; can_connect?: boolean }>>('/instagram/platforms'),
  tiktokAuthUrl: () => api.get<{ url: string }>('/tiktok/auth-url'),
  saveSettings: (s: PublishingSettings, account?: string) =>
    api.put<PublishingSettings & { scheduled: number }>('/instagram/publishing-settings', s, { params: account ? { account } : {} }),
  list:    (account?: string) => api.get<QueueItem[]>('/instagram/queue', { params: account ? { account } : {} }),
  create:  (data: { format: 'reel' | 'story'; caption?: string; scheduled_at?: string | null; file_name: string; file_size: number; account?: string }) =>
    api.post<{ id: string; upload_url: string }>('/instagram/queue', data),
  process: (id: string) => api.post<{
    id: string; status: QueueStatus | 'duplicate'; clean_report: CleanReport | null; lossless: boolean | null;
    duplicate?: { source: 'published' | 'queue'; distance: number; permalink: string | null; published_at: string | null; label: string | null };
    message?: string;
  }>(`/instagram/queue/${id}/process`),
  // Vidéo envoyée : traitement en arrière-plan par le cron du VPS (sprint45)
  markUploaded: (id: string) => api.post<{ id: string; status: 'queued' }>(`/instagram/queue/${id}/process?defer=1`),
  update:  (id: string, data: { caption?: string; scheduled_at?: string | null; status?: 'draft' | 'scheduled' }) =>
    api.patch<QueueItem>(`/instagram/queue/${id}`, data),
  remove:  (id: string) => api.delete(`/instagram/queue/${id}`),
  publish: (id: string) => api.post<{ status: QueueStatus; permalink: string | null; error: string | null }>(`/instagram/queue/${id}/publish`),
  profileShared: (id: string, status: 'shared' | 'skipped') =>
    api.post(`/instagram/queue/${id}/profile-share`, { status }),
  voiceoverEnabled: () => api.get<{ enabled: boolean; auto: boolean }>('/instagram/queue/_/voiceover'),
  voiceover: (id: string, body: { action: 'script'; force?: boolean } | { action: 'save'; segments: VoSegment[] } | { action: 'voice' | 'render' | 'verify' }) =>
    api.post<VoiceoverState>(`/instagram/queue/${id}/voiceover`, body),
  voiceoverStep: (id: string) =>
    api.post<{ step: string; state: VoiceoverState }>(`/instagram/queue/${id}/voiceover`, { action: 'step' }),
  caption: (id: string, force = false) =>
    api.post<{ caption: string; skipped?: boolean }>(`/instagram/queue/${id}/caption`, { force }),
};

// Envoi direct d'un fichier vers Supabase Storage (URL signée), avec progression
// Annulation via `signal` : l'envoi est interrompu et la promesse rejetée avec name = 'AbortError'
export function uploadToSignedUrl(url: string, file: File, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => Object.assign(new Error('Envoi annulé'), { name: 'AbortError' });
    if (signal?.aborted) return reject(aborted());
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload  = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Envoi refusé (HTTP ${xhr.status})`;
      try { msg = JSON.parse(xhr.responseText).message ?? msg; } catch { /* réponse non JSON */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Envoi interrompu (connexion)'));
    xhr.onabort = () => reject(aborted());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export const shiftsApi = {
  start:     () => api.post<{ id: string; started_at: string }>('/shifts/start'),
  end:       (shiftId?: string) => api.post('/shifts/end', shiftId ? { shift_id: shiftId } : {}),
  heartbeat: () => api.post('/shifts/heartbeat'),
  list:      (date?: string) => api.get<any[]>('/shifts', { params: date ? { date } : {} }),
};

export const usersApi = {
  getAll:         (params?: Record<string, unknown>) => api.get<User[]>('/users', { params }),
  getOne:         (id: string) => api.get<User>(`/users/${id}`),
  create:         (data: Partial<User> & { password: string }) => api.post<User>('/users', data),
  update:         (id: string, data: Partial<User> & { password?: string }) =>
    api.put<User>(`/users/${id}`, data),
  deactivate:     (id: string) => api.delete(`/users/${id}`),
  getPerformance: (id: string, days?: number) =>
    api.get(`/users/${id}/performance${days ? `?period=${days}` : ''}`),
};

export const dashboardApi = {
  getStats:          () => api.get('/dashboard/stats'),
  getLeaderboard:    () => api.get('/dashboard/leaderboard'),
  getInstagramStats: () => api.get('/dashboard/instagram-stats'),
};

export const qualiopiLeadsApi = {
  getAll:     (params?: QualiopiLeadsFilters) => api.get('/qualiopi-leads', { params }),
  getOne:     (id: string) => api.get<QualiopiLead>(`/qualiopi-leads/${id}`),
  create:     (data: Partial<QualiopiLead>) => api.post<QualiopiLead>('/qualiopi-leads', data),
  update:     (id: string, data: Partial<QualiopiLead>) => api.put<QualiopiLead>(`/qualiopi-leads/${id}`, data),
  delete:     (id: string) => api.delete(`/qualiopi-leads/${id}`),
  bulkDelete: (ids: string[]) => api.post('/qualiopi-leads/bulk-delete', { ids }),
  bulkStatus: (ids: string[], status: string) => api.patch('/qualiopi-leads/bulk-status', { ids, status }),
  assign:     (leadIds: string[], setterId: string) =>
    api.post('/qualiopi-leads/assign', { lead_ids: leadIds, setter_id: setterId }),
  import:     (formData: FormData) =>
    api.post('/qualiopi-leads/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

export const qualiopiDashboardApi = {
  getStats:       () => api.get('/qualiopi-dashboard/stats'),
  getLeaderboard: () => api.get('/qualiopi-dashboard/leaderboard'),
};

export const notificationsApi = {
  getRecent: () => api.get('/notifications'),
  getAll:    (limit = 100) => api.get('/notifications', { params: { limit } }),
};

export const chatApi = {
  getConversations:   () => api.get('/chat/conversations'),
  createConversation: (data: { member_ids: string[]; name?: string; is_group?: boolean }) =>
    api.post('/chat/conversations', data),
  getMessages:        (convId: string) => api.get(`/chat/conversations/${convId}/messages`),
  sendMessage:        (convId: string, content: string) =>
    api.post(`/chat/conversations/${convId}/messages`, { content }),
  markRead:           (convId: string) => api.put(`/chat/conversations/${convId}/read`),
};

export const tagsApi = {
  getAll: () => api.get<Tag[]>('/tags'),
  create: (data: Pick<Tag, 'name' | 'color'>) => api.post<Tag>('/tags', data),
  update: (id: string, data: Partial<Tag>) => api.put<Tag>(`/tags/${id}`, data),
  delete: (id: string) => api.delete(`/tags/${id}`),
};

export type SocialPlatform = 'instagram' | 'facebook';

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  account_name: string;
  username: string | null;
  login: string | null;
  password: string | null;
  url: string | null;
  notes: string | null;
  assigned_to: string | null;
  created_by: string;
  created_at: string;
  paused_until?: string | null;   // compte au repos (ni follow ni DM de prospection)
  pause_reason?: string | null;
}

export type SocialAccountPayload = Omit<SocialAccount, 'id' | 'created_by' | 'created_at' | 'paused_until' | 'pause_reason'>;

export const socialAccountsApi = {
  getAll:  (platform?: SocialPlatform) =>
    api.get<SocialAccount[]>('/social-accounts', { params: platform ? { platform } : {} }),
  create:  (data: SocialAccountPayload) =>
    api.post<SocialAccount>('/social-accounts', data),
  update:  (id: string, data: Partial<SocialAccountPayload>) =>
    api.put<SocialAccount>(`/social-accounts/${id}`, data),
  delete:  (id: string) => api.delete(`/social-accounts/${id}`),
  // days > 0 : mise au repos ; 0 : réactivation
  pause:   (id: string, days: number, reason?: string) =>
    api.post(`/social-accounts/${id}/pause`, { days, reason }),
};

// ── LinkedIn v2 (sprint44) : invitation → acceptation → premier message rédigé par l'agent →
// relances R1 / R2 / R3, exécuté par le worker du VPS
export interface LinkedinSettings {
  enabled: boolean; ext_key: string; dms_per_day: number;
  work_start_hour: number; work_end_hour: number; weekdays_only: boolean;
  min_gap_minutes: number; max_gap_minutes: number;
  ramp: number[]; ramp_started_at: string | null; weekly_invite_cap: number; invite_expiry_days: number;
  first_msg_min_hours: number; first_msg_max_hours: number;
  r1_days: number; r2_days: number; r3_days: number; end_days: number; inbox_every_minutes: number;
  manual_validation: boolean; validation_target: number; validated_count: number;
  next_action_at: string | null; last_scan_at: string | null; last_inbox_at: string | null; last_seen_at: string | null;
  alert: string | null; alert_at: string | null; stop_reason: string | null; stopped_at: string | null;
  // Montée en charge (sprint46)
  tiers: { min: number; max: number; days?: number[] }[]; tier: number; tier_since: string | null;
  promote_min_days: number; promote_rate: number; promote_rate_last: number; demote_rate: number; rate_min_sample: number;
  last_tier_bonus_pct: number; volume_jitter_pct: number;
  day_start_min: number; day_end_min: number; lunch_start_min: number; lunch_end_min: number;
  invite_gap_min: number; invite_gap_max: number; sessions_min: number; sessions_max: number;
  account_state: 'active' | 'cooldown' | 'blocked'; cooldown_until: string | null; cooldown_days: number; cooldown_tier_drop: number;
  error_streak_max: number; pending_cap: number; pending_suspend: number; reinvite_block_days: number;
  note_split_pct: number; note_templates: Record<string, string>; previsit_enabled: boolean;
  msg_templates?: Record<string, string>;
  relances?: { delay_days: number; cout_client: string; regularite: string }[];
}
export interface LinkedinRate { rate: number | null; sent: number; accepted: number }
export interface LinkedinRates { accept_7: LinkedinRate; accept_30: LinkedinRate; accept_mature: LinkedinRate; reply: { sent: number; replied: number } }
export interface LinkedinRamp {
  tier: number; tiers: { min: number; max: number; days?: number[] }[]; tier_since: string | null; tier_reason: string | null;
  plan: { date: string; target: number; sessions: { start: number; end: number; count: number }[] } | null;
  account_state: 'active' | 'cooldown' | 'blocked'; cooldown_until: string | null;
  weekly_cap: number; invites_week: number; invites_today: number;
  pending_count: number | null; pending_count_at: string | null; pending_cap: number; pending_suspend: number;
  overall: LinkedinRates; by_variant: Record<string, LinkedinRates>; by_sector: Record<string, LinkedinRates>;
  open_profiles: number; previsited: number;
  worker: { id: string | null; ip: string | null; proxy: boolean | null; ips: { ip: string; at: string }[] };
  events: { id: string; type: string; detail: string | null; created_at: string }[];
}
export interface LinkedinExecution {
  state: 'active' | 'paused' | 'outside' | 'stopped' | 'cooldown'; reason: string | null;
  invites_today: number; invites_per_day: number; ramp_week: number; invites_week: number; weekly_cap: number;
  messages_today: number; messages_per_day: number; worker_seen_at: string | null; next_action_at: string | null;
}
export interface LinkedinLead {
  id: string; first_name: string | null; last_name: string | null; company: string | null; job_title: string | null;
  li_sector: string | null; niche?: string | null; linkedin_url: string | null; li_status: LinkedinStatus | null;
  li_enqueued_at: string | null; li_invited_at: string | null; li_connected_at: string | null; li_dm_sent_at: string | null;
  li_last_sent_at: string | null; li_last_kind: string | null; li_due_at: string | null;
  li_seen_at?: string | null;   // premier « Vu » relevé dans la messagerie
  li_variant: string | null; li_question: string | null; li_replied_at: string | null; li_replied_stage: string | null;
  li_reply_text: string | null; li_thread_url: string | null; li_handled_at: string | null; li_error: string | null;
  li_preview: boolean; li_expired_at: string | null; do_not_contact: boolean;
  invite_forecast?: string;   // jour prévu de l'invitation (leads « en séquence »)
  invite_exact?: boolean;     // invite_forecast est l'heure exacte (invitations du jour)
}
export interface LinkedinCandidate {
  id: string; first_name: string | null; last_name: string | null; company: string | null; job_title: string | null;
  li_sector: string | null; linkedin_url: string | null; created_at: string;
}
export interface LinkedinPending {
  stage: string; kind: string; message: string;   // first, r1 … r16, post
  variante?: string; question?: string; element_cite?: string; source?: string; confiance?: string; raison?: string;
  generated_at: string;
}
export interface LinkedinReviewItem {
  id: string; first_name: string | null; last_name: string | null; company: string | null; job_title: string | null;
  linkedin_url: string | null; li_status: LinkedinStatus | null; li_preview: boolean; li_pending: LinkedinPending;
}
export interface LinkedinLogRow {
  id: string; lead_id: string | null; action: string; result: string; detail: string | null; stage: string | null;
  created_at: string; leads: { first_name: string; last_name: string } | null;
}
export interface LinkedinOverview {
  settings: LinkedinSettings;
  execution: LinkedinExecution;
  ramp: LinkedinRamp;
  leads: LinkedinLead[];
  candidates: LinkedinCandidate[];
  review: LinkedinReviewItem[];
  preview_waiting: number;
  log: LinkedinLogRow[];
}
export interface LinkedinImportReport {
  dry_run: boolean; total: number; imported: number; importable: number;
  rejected: { line: number; name: string; reason: string }[];
  warnings: { line: number; name: string; warning: string }[];
}

// ── Inbound (sprint47) : commentaires Instagram et Facebook, abonnements, DM
export interface InboundItem {
  id: string; platform: 'instagram' | 'facebook'; kind: 'comment' | 'follow' | 'dm' | 'story_reply';
  content_queue_id: string | null; media_ref: string | null; permalink: string | null; content_caption: string | null;
  author_name: string | null; author_handle: string | null; author_id: string | null; text: string | null;
  keyword: string | null; intent: 'keyword' | 'interest' | 'other' | null; intent_reason: string | null;
  lead_id: string | null; status: 'new' | 'handled' | 'ignored'; occurred_at: string | null; created_at: string;
  leads: { first_name: string; last_name: string; status: string } | null;
}
export interface InboundSheet {
  items: InboundItem[];
  settings: { account_username: string; keywords: string[]; auto_reply_text: string | null;
    ig_last_sync_at: string | null; ig_last_error: string | null; fb_last_sync_at: string | null; fb_last_error: string | null } | null;
  followers: { day: string; total: number; gained: number }[];
}
export const inboundSheetApi = {
  overview: () => api.get<InboundSheet>('/inbound'),
  setStatus: (action: 'handled' | 'ignored' | 'new', ids: string[]) => api.post('/inbound', { action, ids }),
  createLead: (id: string) => api.post<{ lead_id: string }>('/inbound', { action: 'lead', id }),
};

export const linkedinApi = {
  overview: () => api.get<LinkedinOverview>('/linkedin'),
  saveSettings: (data: Partial<LinkedinSettings>) => api.put<LinkedinSettings>('/linkedin', data),
  forceTier: (tier: number) => api.put('/linkedin', { force_tier: tier }),
  unblock: () => api.put('/linkedin', { unblock: true }),
  leadsAction: (action: 'enqueue' | 'requeue' | 'remove' | 'preview' | 'handled', lead_ids: string[]) =>
    api.post('/linkedin', { action, lead_ids }),
  decide: (action: 'validate' | 'edit' | 'reject', lead_id: string, message?: string) =>
    api.post('/linkedin', { action, lead_id, message }),
  doNotContact: (lead_id: string) => api.post<{ excluded: number }>('/linkedin', { action: 'dnc', lead_id }),
  importCsv: (csv: string, filename: string, opts: { dry_run?: boolean; enqueue?: boolean }) =>
    api.post<LinkedinImportReport>('/linkedin/import', { csv, filename, ...opts }),
};

// ── Fabrique de reels @paymentflow (validation avant programmation) ──
export interface FabriqueReel {
  id: string; day: string; funnel: 'tofu' | 'mofu' | 'bofu'; topic: string; caption: string;
  status: 'planned' | 'rendering' | 'uploaded' | 'failed'; voiced: boolean;
  review_status: 'pending' | 'approved' | 'rejected'; feedback: string | null; error: string | null;
  video_url: string | null; cover_url: string | null; queue_status: string | null; queue_error: string | null;
  scheduled_at: string | null; published_at: string | null; permalink: string | null; created_at: string;
}
export const fabriqueApi = {
  list:   () => api.get<{ preview_url: string; reels: FabriqueReel[] }>('/instagram/fabrique'),
  review: (id: string, action: 'approve' | 'reject', feedback?: string) => api.post<{ scheduled: number }>(`/instagram/fabrique/${id}`, { action, feedback }),
};

// ── Posts LinkedIn automatiques (profil de Lomig) ──
export interface LinkedinPost { id: string; scheduled_at: string; topic: string | null; body: string; photo_id: string | null; photo_url: string | null;
  status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'; post_urn: string | null; error: string | null; feedback: string | null; published_at: string | null }
export interface LinkedinPhoto { id: string; storage_path: string; url: string; uses: number }
export const linkedinPostsApi = {
  list:   () => api.get<{ connection: { connected: boolean; name?: string; expires_at?: string }; photos: LinkedinPhoto[]; posts: LinkedinPost[] }>('/linkedin/posts'),
  action: (body: Record<string, unknown>) => api.post('/linkedin/posts', body),
  connectUrl: () => api.get<{ url: string }>('/linkedin/oauth/start'),
};

// ── Emailing (envois par l'agent Hermès) ──
export interface EmailStepCfg { step: number; delay_days: number; subject: string; body: string }
export type EmailSegment = 'site' | 'no_site';
export interface EmailSettingsCfg { active: boolean; daily_goal: number; steps: EmailStepCfg[]; sequences: Record<EmailSegment, EmailStepCfg[]> | null;
  sender_email: string; sender_name: string; signature: string; imap_checked_at?: string | null; imap_error?: string | null; send_days: number[]; send_from: number; send_to: number; instructions: string }
export interface EmailRate { contacted: number; opened: number; replied: number; open_rate: number | null; reply_rate: number | null }
export interface EmailStats {
  settings: EmailSettingsCfg; by_status: Record<string, number>;
  rates: Record<'7d' | '30d', EmailRate & { by_segment: Record<EmailSegment, EmailRate>; by_step: (EmailRate & { step: number })[] }>;
  leads_by_segment: Record<EmailSegment, number>;
  today: { sent: number; replied: number; bounced: number };
  week: { sent: number; replied: number; bounced: number; interested: number };
  last_event_at: string | null; agent_configured: boolean;
}
export interface EmailLeadRow {
  id: string; email: string; first_name: string | null; last_name: string | null; company: string | null; sector: string | null; city: string | null;
  status: string; step: number; last_sent_at: string | null; next_send_at: string | null; replied_at: string | null; mailbox: string | null;
}
export const emailingApi = {
  stats:    () => api.get<EmailStats>('/emailing/stats'),
  settings: (s: Partial<EmailSettingsCfg>) => api.put<EmailSettingsCfg>('/emailing/settings', s),
  leads:    (params: { status?: string; q?: string; page?: number }) => api.get<{ leads: EmailLeadRow[]; total: number; page: number; size: number }>('/emailing/leads', { params }),
  preview:  (segment: 'site' | 'no_site') => api.get<{ lead: { email: string; company: string } | null; variables: Record<string, string> }>('/emailing/preview', { params: { segment } }),
  import:   (csv: string, file_name: string) => api.post<{ total: number; inserted: number; duplicates: number; invalid: number; dnc: number; errors: string[] }>('/emailing/leads', { csv, file_name }),
};
