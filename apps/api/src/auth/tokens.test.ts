import assert from 'node:assert/strict';
import test from 'node:test';
import { SignJWT } from 'jose';
import { JWT_AUDIENCE, JWT_ISSUER } from './auth.constants';
import { hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken } from './tokens';

const secret = 'test-only-jwt-secret-32-chars-min';

test('signs and verifies an access JWT with issuer, audience and HS256', async (t) => {
  t.after(() => {
    delete process.env.JWT_SECRET;
  });
  process.env.JWT_SECRET = secret;
  const token = await signAccessToken(7, 'MEMBER');
  const claims = await verifyAccessToken(token);
  assert.equal(claims.sub, '7');
  assert.equal(claims.role, 'MEMBER');
  assert.equal(typeof claims.jti, 'string');
});

test('rejects a JWT with the wrong issuer or a bad signature', async (t) => {
  t.after(() => {
    delete process.env.JWT_SECRET;
  });
  process.env.JWT_SECRET = secret;
  const key = new TextEncoder().encode(secret);
  const wrongIssuer = await new SignJWT({ role: 'MEMBER' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('1')
    .setJti('jti')
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer('other')
    .setAudience(JWT_AUDIENCE)
    .sign(key);
  await assert.rejects(() => verifyAccessToken(wrongIssuer));

  const otherKey = new TextEncoder().encode('x'.repeat(32) + '-other');
  const badSig = await new SignJWT({ role: 'ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('1')
    .setJti('jti')
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(otherKey);
  await assert.rejects(() => verifyAccessToken(badSig));
});

test('refresh tokens are opaque and hashed, not reversible from the hash', () => {
  const token = newRefreshToken();
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  const digest = hashRefreshToken(token);
  assert.equal(digest.length, 64);
  assert.notEqual(digest, token);
});
