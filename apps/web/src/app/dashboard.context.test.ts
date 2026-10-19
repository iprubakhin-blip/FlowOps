import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchingCaption,
  showingLabel,
  tasksHeading,
} from './dashboard.context';

test('ADMIN and MEMBER receive distinct dashboard copy', () => {
  assert.equal(tasksHeading('ADMIN'), 'All tasks');
  assert.equal(tasksHeading('MEMBER'), 'My tasks');
  assert.equal(matchingCaption('ADMIN'), 'Server total for current filters');
  assert.match(matchingCaption('MEMBER'), /Your tasks/);
  assert.match(showingLabel('MEMBER', 2, 5), /your matching tasks/);
  assert.doesNotMatch(showingLabel('MEMBER', 2, 5), /global/i);
});
