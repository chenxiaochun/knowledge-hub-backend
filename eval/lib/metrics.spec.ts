// eval/lib/metrics.spec.ts
import { summarizeIntentResults } from './metrics';

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
