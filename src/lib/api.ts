import axios from 'axios';
import type { Lead, User, Tag, LeadsFilters } from '@/types';

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
      localStorage.removeItem('pf_user');
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
  delete:   (id: string) => api.delete(`/leads/${id}`),
  import:   (formData: FormData) =>
    api.post('/leads/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  assign:   (leadIds: string[], setterId: string) =>
    api.post('/leads/assign', { lead_ids: leadIds, setter_id: setterId }),
};

export const usersApi = {
  getAll:         (params?: Record<string, unknown>) => api.get<User[]>('/users', { params }),
  getOne:         (id: string) => api.get<User>(`/users/${id}`),
  create:         (data: Partial<User> & { password: string }) => api.post<User>('/users', data),
  update:         (id: string, data: Partial<User> & { password?: string }) =>
    api.put<User>(`/users/${id}`, data),
  deactivate:     (id: string) => api.delete(`/users/${id}`),
  getPerformance: (id: string) => api.get(`/users/${id}/performance`),
};

export const dashboardApi = {
  getStats:       () => api.get('/dashboard/stats'),
  getLeaderboard: () => api.get('/dashboard/leaderboard'),
};

export const tagsApi = {
  getAll: () => api.get<Tag[]>('/tags'),
  create: (data: Pick<Tag, 'name' | 'color'>) => api.post<Tag>('/tags', data),
  update: (id: string, data: Partial<Tag>) => api.put<Tag>(`/tags/${id}`, data),
  delete: (id: string) => api.delete(`/tags/${id}`),
};
