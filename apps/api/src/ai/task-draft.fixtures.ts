import type { TaskDraftModelOutput } from './task-draft.types';

export const PORTAL_REQUIREMENTS =
  'Build a customer portal with login, account dashboard, invoice viewing, payment integration, and payment history.';

export const PORTAL_DRAFT_OUTPUT: TaskDraftModelOutput = {
  tasks: [
    {
      title: 'Design customer login flow',
      description: 'Specify email/password authentication, session cookies, and failed-login handling for the portal.',
      priority: 'high',
      dueDate: null,
    },
    {
      title: 'Build account dashboard shell',
      description: 'Create the signed-in landing view with account summary placeholders and navigation to invoices and payments.',
      priority: 'high',
      dueDate: null,
    },
    {
      title: 'Implement invoice viewing',
      description: 'List invoices for the signed-in customer and show a read-only invoice detail page.',
      priority: 'medium',
      dueDate: null,
    },
    {
      title: 'Integrate payment capture',
      description: 'Add a payment path for outstanding invoices using the existing payment provider contract.',
      priority: 'high',
      dueDate: null,
    },
    {
      title: 'Show payment history',
      description: 'Display prior successful and failed payments with dates and amounts, without inventing ledger data.',
      priority: 'medium',
      dueDate: null,
    },
  ],
  warnings: [
    'No individual task deadlines were stated, so dueDate is null on every draft.',
  ],
};
