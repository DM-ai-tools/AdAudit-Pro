import type { User as PrismaUser } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { User } from '../types/index.js';
import { generateId } from './mock-store.js';

function toAppUser(row: PrismaUser): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl ?? undefined,
    googleId: row.googleId ?? undefined,
    googleRefreshToken: row.googleRefreshToken ?? undefined,
    googleAccessToken: row.googleAccessToken ?? undefined,
    googleTokenExpiry: row.googleTokenExpiry?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findOrCreateUser(
  email: string,
  name: string,
  googleId?: string,
  avatarUrl?: string
): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: name || existing.name,
        googleId: googleId || existing.googleId,
        avatarUrl: avatarUrl || existing.avatarUrl,
        email: normalizedEmail,
      },
    });
    return toAppUser(updated);
  }

  const created = await prisma.user.create({
    data: {
      id: generateId('usr_'),
      email: normalizedEmail,
      name,
      googleId,
      avatarUrl,
    },
  });
  console.log(`✓ New user stored in PostgreSQL: ${created.email}`);
  return toAppUser(created);
}

export async function getMe(userId: string): Promise<User | undefined> {
  const row = await prisma.user.findUnique({ where: { id: userId } });
  return row ? toAppUser(row) : undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const normalizedEmail = email.trim().toLowerCase();
  const row = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  return row ? toAppUser(row) : undefined;
}

export async function updateUser(
  userId: string,
  partial: Partial<Pick<User, 'name' | 'googleId' | 'avatarUrl' | 'email' | 'googleRefreshToken' | 'googleAccessToken' | 'googleTokenExpiry'>>
): Promise<User | undefined> {
  try {
    const data: Record<string, unknown> = { ...partial };
    if (partial.googleTokenExpiry) {
      data.googleTokenExpiry = new Date(partial.googleTokenExpiry);
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
    });
    return toAppUser(updated);
  } catch {
    return undefined;
  }
}

export async function countUsers(): Promise<number> {
  return prisma.user.count();
}
