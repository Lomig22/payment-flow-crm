import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export interface AuthUser {
  id:         string;
  email:      string;
  first_name: string;
  last_name:  string;
  role:       'admin' | 'setter';
  is_active:  boolean;
}

export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;

    const token   = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };

    const result = await query(
      'SELECT id, email, first_name, last_name, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    const user = result.rows[0];
    if (!user || !user.is_active) return null;
    return user;
  } catch {
    return null;
  }
}

export const unauthorized = () =>
  NextResponse.json({ message: 'Non authentifié' }, { status: 401 });

export const forbidden = () =>
  NextResponse.json({ message: 'Accès réservé aux administrateurs' }, { status: 403 });

export const notFound = (msg = 'Introuvable') =>
  NextResponse.json({ message: msg }, { status: 404 });

export const badRequest = (msg: string) =>
  NextResponse.json({ message: msg }, { status: 400 });
