import { describe, expect, it } from 'vitest';
import { canTransition, completeFinish, isTerminal, type JobState } from '@domain/job';

describe('job FSM (F5-FR6 / I-3)', () => {
  it('allows the forward path queued -> ... -> finishing', () => {
    const path: Array<[JobState, JobState]> = [
      ['queued', 'capturing'],
      ['capturing', 'converting'],
      ['converting', 'hashing'],
      ['hashing', 'uploading'],
      ['uploading', 'finishing'],
      ['finishing', 'done'],
    ];
    for (const [from, to] of path) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('makes done reachable ONLY from finishing (I-3)', () => {
    const nonFinishing: JobState[] = ['queued', 'capturing', 'converting', 'hashing', 'uploading'];
    for (const state of nonFinishing) {
      expect(canTransition(state, 'done')).toBe(false);
    }
    expect(canTransition('finishing', 'done')).toBe(true);
  });

  it('forbids skipping finish: uploading cannot go straight to done (F5-AC6)', () => {
    expect(canTransition('uploading', 'done')).toBe(false);
    expect(canTransition('uploading', 'finishing')).toBe(true);
  });

  it('allows failing from any non-terminal state', () => {
    for (const state of [
      'queued',
      'capturing',
      'converting',
      'hashing',
      'uploading',
      'finishing',
    ] as JobState[]) {
      expect(canTransition(state, 'failed')).toBe(true);
    }
  });

  it('treats done and failed as terminal (no further transitions)', () => {
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(canTransition('done', 'capturing')).toBe(false);
    expect(canTransition('failed', 'queued')).toBe(false);
  });

  it('non-terminal states are not terminal', () => {
    expect(isTerminal('uploading')).toBe(false);
  });

  it('completeFinish maps a successful finish to done', () => {
    expect(completeFinish('finishing', true)).toBe('done');
  });

  it('completeFinish maps a failed finish to failed, never done (apply-without-finish)', () => {
    expect(completeFinish('finishing', false)).toBe('failed');
  });

  it('completeFinish refuses to run from any state other than finishing', () => {
    expect(() => completeFinish('uploading', true)).toThrow('illegal state');
  });
});
