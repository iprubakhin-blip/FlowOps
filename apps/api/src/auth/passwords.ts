import { argon2id, hash, verify } from 'argon2';
import { argon2MemoryCost, argon2TimeCost } from './auth.config';

function hashOptions(): { type: typeof argon2id; memoryCost: number; timeCost: number; parallelism: number } {
  return {
    type: argon2id,
    memoryCost: argon2MemoryCost(),
    timeCost: argon2TimeCost(),
    parallelism: 1,
  };
}

let dummyHashPromise: Promise<string> | undefined;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, hashOptions());
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('flowops-dummy-password-not-a-user');
  return dummyHashPromise;
}

export async function verifyUnknownUserPassword(password: string): Promise<void> {
  await verifyPassword(await dummyPasswordHash(), password);
}
