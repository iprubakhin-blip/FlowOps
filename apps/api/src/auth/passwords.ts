import { argon2id, hash, verify } from 'argon2';

// OWASP Argon2id baseline for interactive logins: 19 MiB, 2 iterations, 1 lane.
// Tests may lower AUTH_ARGON2_MEMORY / AUTH_ARGON2_TIME; do not lower production defaults.
const DEFAULT_MEMORY = 19_456;
const DEFAULT_TIME = 2;

function hashOptions(): { type: typeof argon2id; memoryCost: number; timeCost: number; parallelism: number } {
  return {
    type: argon2id,
    memoryCost: Number(process.env.AUTH_ARGON2_MEMORY ?? DEFAULT_MEMORY),
    timeCost: Number(process.env.AUTH_ARGON2_TIME ?? DEFAULT_TIME),
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
