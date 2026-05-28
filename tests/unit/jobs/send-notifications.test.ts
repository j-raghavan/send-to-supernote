import { describe, expect, it } from 'vitest';
import {
  NOTE_CAPTURING,
  NOTE_CONNECT_FIRST,
  NOTE_CONVERTING,
  noteConversionFailed,
  noteSendFailed,
  noteSent,
  noteUploading,
} from '@jobs/send-notifications';

describe('send notifications (F6-FR5)', () => {
  it('progress toasts cover capturing -> converting -> uploading', () => {
    expect(NOTE_CAPTURING.level).toBe('progress');
    expect(NOTE_CONVERTING.level).toBe('progress');
    expect(noteUploading('A.pdf')).toEqual({
      level: 'progress',
      title: 'Uploading',
      message: 'Sending A.pdf…',
    });
  });

  it('the success toast names the file and prompts a device sync', () => {
    const note = noteSent('A.pdf');
    expect(note.level).toBe('success');
    expect(note.message).toContain('A.pdf');
    expect(note.message).toContain('sync your device');
  });

  it('connect-first is an actionable error', () => {
    expect(NOTE_CONNECT_FIRST.level).toBe('error');
    expect(NOTE_CONNECT_FIRST.message).toContain('Options');
  });

  it('failure toasts carry the actionable reason', () => {
    expect(noteSendFailed('apply broke').message).toBe('apply broke');
    expect(noteSendFailed('apply broke').level).toBe('error');
    expect(noteConversionFailed('render broke').title).toBe('Conversion failed');
  });
});
