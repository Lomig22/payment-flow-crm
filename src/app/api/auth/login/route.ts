import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ message: 'Email et mot de passe requis' }, { status: 400 });
    }

    const result = await query(
      'SELECT id, email, password_hash, first_name, last_name, role, is_active, avatar_url FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = result.rows[0];
    if (!user) {
      return NextResponse.json({ message: 'Identifiants incorrects' }, { status: 401 });
    }
    if (!user.is_active) {
      return NextResponse.json({ message: 'Compte désactivé' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ message: 'Identifiants incorrects' }, { status: 401 });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    const { password_hash, ...userOut } = user;
    return NextResponse.json({ token, user: userOut });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });
  }
}
