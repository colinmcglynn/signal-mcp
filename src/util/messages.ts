import { msToIso } from './time.js';

export interface RawMessageRow {
  id: string;
  conversationId: string;
  chat_name: string | null;
  chat_type: string;
  chat_profileFullName: string | null;
  chat_profileName: string | null;
  chat_e164: string | null;
  type: string;
  received_at: number | null;
  sent_at: number | null;
  body: string | null;
  sourceServiceId: string | null;
  hasAttachments: number | null;
  hasVisualMediaAttachments: number | null;
  hasFileAttachments: number | null;
  sender_name: string | null;
  sender_profileFullName: string | null;
  sender_profileName: string | null;
  sender_e164: string | null;
}

export interface MessageOut {
  id: string;
  chat_id: string;
  chat_name: string;
  is_group: boolean;
  date: string | null;
  sender: string;
  direction: 'incoming' | 'outgoing' | 'system';
  body: string | null;
  has_attachments: boolean;
  message_type: string;
}

export function chatDisplayName(row: {
  chat_name: string | null;
  chat_profileFullName?: string | null;
  chat_profileName?: string | null;
  chat_e164?: string | null;
}): string {
  return (
    row.chat_name ||
    row.chat_profileFullName ||
    row.chat_profileName ||
    row.chat_e164 ||
    '(unknown)'
  );
}

export function senderDisplayName(row: RawMessageRow): string {
  if (row.type === 'outgoing') return 'me';
  return (
    row.sender_profileFullName ||
    row.sender_profileName ||
    row.sender_name ||
    row.sender_e164 ||
    row.sourceServiceId ||
    '(unknown)'
  );
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
    date: msToIso(row.received_at ?? row.sent_at),
    sender: senderDisplayName(row),
    direction: direction(row),
    body: row.body,
    has_attachments: Boolean(row.hasAttachments || row.hasVisualMediaAttachments || row.hasFileAttachments),
    message_type: row.type,
  };
}
