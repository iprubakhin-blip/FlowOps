import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../http/validation-error';
import { PORTAL_REQUIREMENTS } from './task-draft.fixtures';
import { parseTaskDraftRequest } from './task-draft.request';

test('parses a valid task-draft request and ignores missing consent as false', () => {
  const parsed = parseTaskDraftRequest({
    requirements: PORTAL_REQUIREMENTS,
    team: 'Platform',
  });
  assert.equal(parsed.team, 'Platform');
  assert.equal(parsed.allowExternalProcessing, false);
});

test('rejects empty requirements, invalid team, extra fields, and forged owner ids', () => {
  assert.throws(() => parseTaskDraftRequest({ requirements: 'short', team: 'Platform' }), ValidationError);
  assert.throws(() => parseTaskDraftRequest({ requirements: PORTAL_REQUIREMENTS, team: 'x' }), ValidationError);
  assert.throws(
    () => parseTaskDraftRequest({ requirements: PORTAL_REQUIREMENTS, team: 'Platform', ownerId: 9 }),
    /Unsupported field/,
  );
  assert.throws(
    () => parseTaskDraftRequest({ requirements: PORTAL_REQUIREMENTS, team: 'Platform', userId: 1 }),
    /Unsupported field/,
  );
  assert.throws(
    () => parseTaskDraftRequest({ requirements: PORTAL_REQUIREMENTS, team: 'Platform', allowExternalProcessing: 'yes' }),
    /boolean/,
  );
});
