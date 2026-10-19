export const USER_ROLES = ['ADMIN', 'MEMBER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface PublicUser {
  id: number;
  email: string;
  role: UserRole;
}

export interface AuthUserResponse {
  user: PublicUser;
}
