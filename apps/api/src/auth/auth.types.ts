export const USER_ROLES = ['ADMIN', 'MEMBER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface PublicUser {
  id: number;
  email: string;
  role: UserRole;
}

export interface UserRecord extends PublicUser {
  passwordHash: string;
}

export interface RefreshSessionRecord {
  id: number;
  userId: number;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  replacedAt: Date | null;
  revokedAt: Date | null;
}

export interface Credentials {
  email: string;
  password: string;
}

export function toPublicUser(user: PublicUser): PublicUser {
  return { id: user.id, email: user.email, role: user.role };
}

export function isRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.some((role) => role === value);
}
