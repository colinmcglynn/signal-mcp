import { msToIso } from './time.js';

export interface RawMessageRow {
  id: string;
  conversationId: string;
  chat_name: string | null;
  chat_type: string;
  chat_serviceId: string | null;
  chat_profileFullName: string | null;
  chat_profileName: string | null;
  chat_profileFamilyName: string | null;
  chat_e164: string | null;
  type: string;
  received_at: number | null;
  sent_at: number | null;
  time_key: number | null;
  body: string | null;
  sourceServiceId: string | null;
  hasAttachments: number | null;
  hasVisualMediaAttachments: number | null;
  hasFileAttachments: number | null;
  sender_name: string | null;
  sender_profileFullName: string | null;
  sender_profileName: string | null;
  sender_profileFamilyName: string | null;
  sender_e164: string | null;
}

export interface MessageOut {
  id: string;
  chat_id: string;
  chat_name: string;
  is_group: boolean;
  date: string | null;
  sent_at: string | null;
  received_at: string | null;
  sender: string;
  direction: 'incoming' | 'outgoing' | 'system';
  body: string | null;
  has_attachments: boolean;
  message_type: string;
}

function nonEmpty(s: string | null | undefined): string | undefined {
  if (s === null || s === undefined) return undefined;
  const trimmed = s.trim();
  return trimmed === '' ? undefined : trimmed;
}

function shortServiceId(uuid: string | null | undefined): string | undefined {
  // Render an unknown contact as e.g. "user-8f881003" so it's at least
  // distinguishable from other unknowns in the same output.
  const id = nonEmpty(uuid);
  if (!id) return undefined;
  return `user-${id.slice(0, 8)}`;
}

/**
 * Resolve a display name for a person/contact, given the conversations-table
 * fields we have. Tries:
 *   1. Explicit `name` (set by the user, or by Signal for known contacts)
 *   2. `profileFullName`
 *   3. `profileName + ' ' + profileFamilyName` (some contacts only have parts)
 *   4. `profileName` alone, then `profileFamilyName` alone
 *   5. `e164` phone number
 *   6. A short slice of the serviceId UUID
 *   7. The literal string `'(unknown)'`
 */
export function personDisplayName(fields: {
  name?: string | null;
  profileFullName?: string | null;
  profileName?: string | null;
  profileFamilyName?: string | null;
  e164?: string | null;
  serviceId?: string | null;
}): string {
  const name = nonEmpty(fields.name);
  if (name) return name;

  const full = nonEmpty(fields.profileFullName);
  if (full) return full;

  const first = nonEmpty(fields.profileName);
  const family = nonEmpty(fields.profileFamilyName);
  if (first && family) return `${first} ${family}`;
  if (first) return first;
  if (family) return family;

  const phone = nonEmpty(fields.e164);
  if (phone) return phone;

  const sid = shortServiceId(fields.serviceId);
  if (sid) return sid;

  return '(unknown)';
}

export function chatDisplayName(row: RawMessageRow): string {
  return personDisplayName({
    name: row.chat_name,
    profileFullName: row.chat_profileFullName,
    profileName: row.chat_profileName,
    profileFamilyName: row.chat_profileFamilyName,
    e164: row.chat_e164,
    serviceId: row.chat_serviceId,
  });
}

export function senderDisplayName(row: RawMessageRow): string {
  if (row.type === 'outgoing') return 'me';
  return personDisplayName({
    name: row.sender_name,
    profileFullName: row.sender_profileFullName,
    profileName: row.sender_profileName,
    profileFamilyName: row.sender_profileFamilyName,
    e164: row.sender_e164,
    serviceId: row.sourceServiceId,
  });
}

export function direction(row: { type: string }): 'incoming' | 'outgoing' | 'system' {
  if (row.type === 'incoming') return 'incoming';
  if (row.type === 'outgoing') return 'outgoing';
  return 'system';
}

export function toMessageOut(row: RawMessageRow): MessageOut {
  return {
    id: row.id,
    chat_id: row.conversationId,
    chat_name: chatDisplayName(row),
    is_group: row.chat_type === 'group',
    date: msToIso(row.time_key ?? row.sent_at ?? row.received_at),
    sent_at: msToIso(row.sent_at),
    received_at: msToIso(row.received_at),
    sender: senderDisplayName(row),
    direction: direction(row),
    body: row.body,
    has_attachments: Boolean(row.hasAttachments || row.hasVisualMediaAttachments || row.hasFileAttachments),
    message_type: row.type,
  };
}
