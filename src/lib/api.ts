import axios from 'axios';
import type { Lead, User, Tag, LeadsFilters, QualiopiLead, QualiopiLeadsFilters } from '@/types';

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
  sendConfirmation: (id: string) => api.post<{ ok: boolean; sent_at: string }>(`/leads/${id}/send-confirmation`),
  niches:   (source?: string) => api.get<string[]>('/leads/niches', { params: source ? { source } : undefined }),
};

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
}

export type SocialAccountPayload = Omit<SocialAccount, 'id' | 'created_by' | 'created_at'>;

export const socialAccountsApi = {
  getAll:  (platform?: SocialPlatform) =>
    api.get<SocialAccount[]>('/social-accounts', { params: platform ? { platform } : {} }),
  create:  (data: SocialAccountPayload) =>
    api.post<SocialAccount>('/social-accounts', data),
  update:  (id: string, data: Partial<SocialAccountPayload>) =>
    api.put<SocialAccount>(`/social-accounts/${id}`, data),
  delete:  (id: string) => api.delete(`/social-accounts/${id}`),
};
