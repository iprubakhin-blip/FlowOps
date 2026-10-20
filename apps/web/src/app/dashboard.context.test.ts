import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchingCaption,
  showingLabel,
  summaryCaption,
  tasksHeading,
} from './dashboard.context';

test('ADMIN and MEMBER receive distinct dashboard copy', () => {
  assert.equal(tasksHeading('ADMIN'), 'All tasks');
  assert.equal(tasksHeading('MEMBER'), 'My tasks');
  assert.match(matchingCaption('ADMIN'), /current search and filters/);
  assert.match(matchingCaption('MEMBER'), /Your tasks/);
  assert.match(summaryCaption('ADMIN'), /authorized to see/);
  assert.match(summaryCaption('MEMBER'), /Your tasks only/);
  assert.doesNotMatch(summaryCaption('MEMBER'), /global/i);
  assert.match(showingLabel('MEMBER', 2, 5), /your matching tasks/);
  assert.doesNotMatch(showingLabel('MEMBER', 2, 5), /global/i);
});
