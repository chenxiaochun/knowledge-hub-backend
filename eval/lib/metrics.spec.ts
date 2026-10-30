import {
  docHitAtK,
  hitAtK,
  summarizeIntentResults,
  summarizeRetrievalResults,
  titleHitAtK,
} from './metrics';

describe('hitAtK', () => {
  it('requires all keywords to appear (case-insensitive)', () => {
    expect(hitAtK('差旅报销需要审批', ['差旅', '审批'])).toBe(true);
    expect(hitAtK('差旅报销需要审批', ['差旅', '年假'])).toBe(false);
    expect(hitAtK('CAS Ticket 说明', ['cas', 'ticket'])).toBe(true);
  });
});

describe('docHitAtK / titleHitAtK', () => {
  it('matches any expected doc id or title fragment', () => {
    expect(docHitAtK(['111', '222'], ['222'])).toBe(true);
    expect(docHitAtK(['111'], ['999'])).toBe(false);
    expect(titleHitAtK(['绩效管理制度（V2.0）'], ['绩效管理'])).toBe(true);
    expect(titleHitAtK(['员工手册'], ['统一认证'])).toBe(false);
  });
});

describe('summarizeRetrievalResults', () => {
  it('aggregates keyword/doc/grade rates', () => {
    const summary = summarizeRetrievalResults([
      {
        id: '1',
        ok: true,
        keywordOk: true,
        docOk: true,
        titleOk: null,
        gradeOk: true,
        keywords: ['a'],
        missingKeywords: [],
        mustDocIds: ['1'],
        hitDocIds: ['1'],
        hitCount: 3,
        topK: 5,
      },
      {
        id: '2',
        ok: false,
        keywordOk: false,
        docOk: false,
        titleOk: null,
        gradeOk: false,
        keywords: ['b'],
        missingKeywords: ['b'],
        mustDocIds: ['9'],
        hitDocIds: [],
        hitCount: 0,
        topK: 5,
      },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.overallAccuracy).toBe(0.5);
    expect(summary.keywordHitAtK).toBe(0.5);
    expect(summary.docHitAtK).toBe(0.5);
    expect(summary.gradeAccuracy).toBe(0.5);
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
