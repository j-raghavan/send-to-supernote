import { beforeEach, describe, expect, it } from 'vitest';
import { JobHistory } from '@jobs/job-history';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeClock } from '../../fakes/fake-clock';

describe('JobHistory (F6-FR6 / Observability)', () => {
  let kv: FakeKeyValueStore;
  let clock: FakeClock;
  let history: JobHistory;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    clock = new FakeClock(1000);
    history = new JobHistory(kv, clock);
  });

  it('starts empty', async () => {
    expect(await history.list()).toEqual([]);
  });

  it('records a successful send newest-first with a timestamp', async () => {
    await history.record('A.pdf', 'done');
    clock.set(2000);
    await history.record('B.pdf', 'done');
    const list = await history.list();
    expect(list.map((e) => e.fileName)).toEqual(['B.pdf', 'A.pdf']);
    expect(list[0]!.at).toBe(2000);
    expect(list[0]!.outcome).toBe('done');
  });

  it('records a failure with a reason', async () => {
    await history.record('C.pdf', 'failed', 'session expired');
    const list = await history.list();
    expect(list[0]!.outcome).toBe('failed');
    expect(list[0]!.reason).toBe('session expired');
  });

  it('caps the log at 10 entries', async () => {
    for (let i = 0; i < 15; i += 1) {
      await history.record(`f${i}.pdf`, 'done');
    }
    const list = await history.list();
    expect(list).toHaveLength(10);
    expect(list[0]!.fileName).toBe('f14.pdf');
  });

  it('tolerates a corrupt stored value', async () => {
    await kv.set('jobs.history', 'not-an-array');
    expect(await history.list()).toEqual([]);
  });
});
