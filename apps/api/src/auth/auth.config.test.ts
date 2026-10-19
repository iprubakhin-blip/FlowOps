import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessTtlSeconds,
  appMode,
  argon2MemoryCost,
  argon2TimeCost,
  assertSecurityConfig,
  cookieSecure,
  isIsolatedTestDatabaseName,
  loginThrottleLimit,
} from './auth.config';
import { ACCESS_TTL_SECONDS } from './auth.constants';

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const keys = Object.keys(overrides);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('NODE_ENV unset or unexpected refuses to select development security defaults', () => {
  withEnv({ NODE_ENV: undefined }, () => {
    assert.throws(() => appMode(), /NODE_ENV must be production, development, or test/);
    assert.throws(() => assertSecurityConfig(), /NODE_ENV must be production, development, or test/);
  });
  withEnv({ NODE_ENV: 'staging' }, () => {
    assert.throws(() => appMode(), /NODE_ENV must be production, development, or test/);
  });
});

test('development may disable Secure cookies for local HTTP', () => {
  withEnv({ NODE_ENV: 'development', AUTH_COOKIE_SECURE: 'false' }, () => {
    assert.equal(cookieSecure(), false);
    assert.doesNotThrow(() => assertSecurityConfig());
  });
});

test('production defaults to Secure cookies when AUTH_COOKIE_SECURE is omitted', () => {
  withEnv({
    NODE_ENV: 'production',
    AUTH_COOKIE_SECURE: undefined,
    JWT_SECRET: 'production-jwt-secret-32-chars-min',
    AUTH_ACCESS_TTL_SECONDS: undefined,
    AUTH_ARGON2_MEMORY: undefined,
    AUTH_ARGON2_TIME: undefined,
  }, () => {
    assert.equal(cookieSecure(), true);
    assert.doesNotThrow(() => assertSecurityConfig());
  });
});

test('production refuses AUTH_COOKIE_SECURE=false', () => {
  withEnv({ NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false', JWT_SECRET: 'production-jwt-secret-32-chars-min' }, () => {
    assert.throws(() => assertSecurityConfig(), /AUTH_COOKIE_SECURE=false is not allowed/);
  });
});

test('production refuses an invalid AUTH_COOKIE_SECURE value', () => {
  withEnv({ NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'sometimes', JWT_SECRET: 'production-jwt-secret-32-chars-min' }, () => {
    assert.throws(() => assertSecurityConfig(), /must be true or false/);
  });
});

test('production refuses a missing JWT_SECRET', () => {
  withEnv({ NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'true', JWT_SECRET: undefined }, () => {
    assert.throws(() => assertSecurityConfig(), /JWT_SECRET is required in production/);
  });
});

test('invalid AUTH_COOKIE_SECURE throws outside production as well', () => {
  withEnv({ NODE_ENV: 'development', AUTH_COOKIE_SECURE: 'yes' }, () => {
    assert.throws(() => cookieSecure(), /must be true, false, or omitted/);
  });
});

test('production access TTL stays 15 minutes and rejects AUTH_ACCESS_TTL_SECONDS', () => {
  withEnv({ NODE_ENV: 'production', AUTH_ACCESS_TTL_SECONDS: undefined }, () => {
    assert.equal(accessTtlSeconds(), ACCESS_TTL_SECONDS);
  });
  withEnv({ NODE_ENV: 'production', AUTH_ACCESS_TTL_SECONDS: '8' }, () => {
    assert.throws(() => accessTtlSeconds(), /not allowed when NODE_ENV=production/);
  });
});

test('non-production AUTH_ACCESS_TTL_SECONDS may shorten the access JWT for isolated tests', () => {
  withEnv({ NODE_ENV: 'test', AUTH_ACCESS_TTL_SECONDS: '8' }, () => {
    assert.equal(accessTtlSeconds(), 8);
  });
});

test('invalid AUTH_ACCESS_TTL_SECONDS is rejected', () => {
  withEnv({ NODE_ENV: 'development', AUTH_ACCESS_TTL_SECONDS: '0' }, () => {
    assert.throws(() => accessTtlSeconds(), /positive integer/);
  });
});

test('production Argon2 parameters cannot fall below the OWASP floor', () => {
  withEnv({ NODE_ENV: 'production', AUTH_ARGON2_MEMORY: '4096', JWT_SECRET: 'production-jwt-secret-32-chars-min' }, () => {
    assert.throws(() => argon2MemoryCost(), /AUTH_ARGON2_MEMORY/);
  });
  withEnv({ NODE_ENV: 'production', AUTH_ARGON2_TIME: '1', JWT_SECRET: 'production-jwt-secret-32-chars-min' }, () => {
    assert.throws(() => argon2TimeCost(), /AUTH_ARGON2_TIME/);
  });
});

test('invalid Argon2 and throttle configuration is rejected', () => {
  withEnv({ NODE_ENV: 'development', AUTH_ARGON2_MEMORY: 'nope' }, () => {
    assert.throws(() => argon2MemoryCost(), /positive integer/);
  });
  withEnv({ NODE_ENV: 'development', AUTH_LOGIN_THROTTLE_LIMIT: '0' }, () => {
    assert.throws(() => loginThrottleLimit(), /positive integer/);
  });
  withEnv({ NODE_ENV: 'production', AUTH_LOGIN_THROTTLE_LIMIT: '500', JWT_SECRET: 'production-jwt-secret-32-chars-min' }, () => {
    assert.throws(() => loginThrottleLimit(), /between/);
  });
});

test('isolated test database names are exact, not substring matches', () => {
  assert.equal(isIsolatedTestDatabaseName('flowops_test'), true);
  assert.equal(isIsolatedTestDatabaseName('flowops_test_auth'), true);
  assert.equal(isIsolatedTestDatabaseName('flowops_test_auth_rl'), true);
  assert.equal(isIsolatedTestDatabaseName('flowops'), false);
  assert.equal(isIsolatedTestDatabaseName('flowops_test_prod_real'), true);
  assert.equal(isIsolatedTestDatabaseName('not_flowops_test'), false);
  assert.equal(isIsolatedTestDatabaseName('flowops_testing'), false);
});
