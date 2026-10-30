// eval/lib/metrics.spec.ts
import { hitAtK, summarizeIntentResults, summarizeRetrievalResults } from './metrics';

describe('hitAtK', () => {
  it('requires all keywords to appear (case-insensitive)', () => {
    expect(hitAtK('差旅报销需要审批', ['差旅', '审批'])).toBe(true);
    expect(hitAtK('差旅报销需要审批', ['差旅', '年假'])).toBe(false);
    expect(hitAtK('CAS Ticket 说明', ['cas', 'ticket'])).toBe(true);
  });
});

describe('summarizeRetrievalResults', () => {
  it('computes hitAtK rate', () => {
    const summary = summarizeRetrievalResults([
      { id: '1', hit: true, keywords: ['a'], missing: [], hitCount: 3, topK: 5 },
      { id: '2', hit: false, keywords: ['b'], missing: ['b'], hitCount: 0, topK: 5 },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.hitAtK).toBe(0.5);
    expect(summary.failures).toHaveLength(1);
  });
});

describe('summarizeIntentResults', () => {
  it('computes accuracies and confusion', () => {
    const summary = summarizeIntentResults([
      {
        id: '1',
        expectIntent: 'kb',
        predIntent: 'kb',
        expectAllowGraph: true,
        predAllowGraph: true,
        expectAllowWeb: false,
        predAllowWeb: false,
      },
      {
        id: '2',
        expectIntent: 'kb',
        predIntent: 'web',
        expectAllowGraph: true,
        predAllowGraph: false,
        expectAllowWeb: false,
        predAllowWeb: true,
      },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.intentAccuracy).toBe(0.5);
    expect(summary.allowGraphAccuracy).toBe(0.5);
    expect(summary.allowWebAccuracy).toBe(0.5);
    expect(summary.confusion.kb.kb).toBe(1);
    expect(summary.confusion.kb.web).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].id).toBe('2');
  });
});
