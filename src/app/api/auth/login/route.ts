import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ message: 'Email et mot de passe requis' }, { status: 400 });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, password_hash, first_name, last_name, role, is_active, avatar_url')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
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
    void password_hash;
    return NextResponse.json({ token, user: userOut });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });
  }
}
