import type { ContactStatus } from '../types';

const TRANSITIONS: Record<ContactStatus, ContactStatus[]> = {
  NEW: ['DRAFTED', 'DO_NOT_CONTACT', 'OPTED_OUT'],
  DRAFTED: ['APPROVED', 'DO_NOT_CONTACT', 'OPTED_OUT'],
  APPROVED: ['SENT', 'FAILED', 'DO_NOT_CONTACT', 'OPTED_OUT'],
  SENT: ['REPLIED', 'DO_NOT_CONTACT', 'OPTED_OUT'],
  REPLIED: ['DO_NOT_CONTACT', 'OPTED_OUT'],
  FAILED: ['DRAFTED', 'APPROVED', 'DO_NOT_CONTACT', 'OPTED_OUT'],
  OPTED_OUT: [],
  DO_NOT_CONTACT: [],
};

export function canTransition(from: ContactStatus, to: ContactStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionError(from: ContactStatus, to: ContactStatus): string | null {
  if (from === 'DO_NOT_CONTACT' || from === 'OPTED_OUT') {
    return 'Do-not-contact status cannot be changed back.';
  }
  if ((to === 'SENT' && from !== 'APPROVED') || (from === 'NEW' && to === 'SENT') || (from === 'DRAFTED' && to === 'SENT')) {
    return 'A message must be approved before it can be sent.';
  }
  if (!canTransition(from, to)) {
    return `Cannot change status from ${from} to ${to}.`;
  }
  return null;
}

export function isDoNotContact(status: ContactStatus): boolean {
  return status === 'DO_NOT_CONTACT' || status === 'OPTED_OUT';
}
