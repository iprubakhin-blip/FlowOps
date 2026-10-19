import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { checksumSql, migrationChecksumMatches, normalizeSqlNewlines } from './migrate';

const lf = 'CREATE TABLE demo (\n  id INTEGER\n);\n';
const crlf = 'CREATE TABLE demo (\r\n  id INTEGER\r\n);\r\n';

test('LF and CRLF SQL produce the same stored checksum', () => {
  assert.equal(checksumSql(lf), checksumSql(crlf));
  assert.equal(normalizeSqlNewlines(crlf), lf);
});

test('checksum verification accepts recorded LF, CRLF, and raw hashes of the same SQL', () => {
  const normalized = checksumSql(lf);
  const rawLf = createHash('sha256').update(lf, 'utf8').digest('hex');
  const rawCrlf = createHash('sha256').update(crlf, 'utf8').digest('hex');
  assert.equal(migrationChecksumMatches(normalized, lf), true);
  assert.equal(migrationChecksumMatches(rawLf, lf), true);
  assert.equal(migrationChecksumMatches(rawCrlf, lf), true);
  assert.equal(migrationChecksumMatches(rawCrlf, crlf), true);
});

test('actual SQL drift still fails checksum verification', () => {
  const recorded = checksumSql(lf);
  assert.equal(migrationChecksumMatches(recorded, `${lf}\n-- changed\n`), false);
  assert.equal(migrationChecksumMatches(recorded, crlf.replace('demo', 'other')), false);
});
