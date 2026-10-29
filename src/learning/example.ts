import type { JoinLesson } from './join-lab';

export const exampleLesson = {
  kind: 'join-lab', schemaVersion: 1, id: 'join-example', version: 1,
  title: 'Which rows combine?',
  source: { sourceId: 'cleared-example', version: 1, digest: 'synthetic-v1' },
  practice: {
    id: 'practice', title: 'Members and invitations',
    left: {
      id: 'practice-members', title: 'Members',
      columns: [{ id: 'p-key', label: 'Team', type: 'string' }, { id: 'p-alt', label: 'Color', type: 'string' }],
      rows: [
        { id: 'practice-a', values: ['x', 'red'] },
        { id: 'practice-b', values: ['y', 'blue'] },
        { id: 'practice-null', values: [null, 'red'] },
      ],
    },
    right: {
      id: 'practice-invitations', title: 'Invitations',
      columns: [{ id: 'p-rkey', label: 'Team', type: 'string' }, { id: 'p-ralt', label: 'Color', type: 'string' }],
      rows: [
        { id: 'practice-r1', values: ['x', 'red'] },
        { id: 'practice-r2', values: ['x', 'blue'] },
        { id: 'practice-r3', values: ['z', 'blue'] },
        { id: 'practice-rnull', values: [null, 'red'] },
      ],
    },
    join: { mode: 'INNER', leftColumnId: 'p-key', rightColumnId: 'p-rkey' },
  },
  transfer: {
    id: 'transfer', title: 'Shipments and warehouse scans',
    left: {
      id: 'transfer-shipments', title: 'Shipments',
      columns: [{ id: 't-key', label: 'Dock', type: 'integer' }],
      rows: [
        { id: 'transfer-a', values: [0] }, { id: 'transfer-b', values: [0] },
        { id: 'transfer-unmatched', values: [7] }, { id: 'transfer-null', values: [null] },
      ],
    },
    right: {
      id: 'transfer-scans', title: 'Scans',
      columns: [{ id: 't-rkey', label: 'Dock', type: 'integer' }],
      rows: [
        { id: 'transfer-r1', values: [0] }, { id: 'transfer-r2', values: [0] },
        { id: 'transfer-rnull', values: [null] }, { id: 'transfer-unused', values: [9] },
      ],
    },
    join: { mode: 'LEFT', leftColumnId: 't-key', rightColumnId: 't-rkey' },
  },
} satisfies JoinLesson;
