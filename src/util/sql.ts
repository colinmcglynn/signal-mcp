import { isoToMs } from './time.js';

export interface MessageFilters {
  since?: string;
  until?: string;
  sender: 'me' | 'them' | 'any';
  only_with_body: boolean;
  exclude_system: boolean;
  limit: number;
  offset: number;
}

export interface ScopeFilters {
  chat_ids?: string[];
  chat_name_contains?: string;
}

export const MESSAGE_SELECT_COLUMNS = `
  m.id AS id,
  m.conversationId AS conversationId,
  m.type AS type,
  m.received_at AS received_at,
  m.sent_at AS sent_at,
  m.body AS body,
  m.sourceServiceId AS sourceServiceId,
  m.hasAttachments AS hasAttachments,
  m.hasVisualMediaAttachments AS hasVisualMediaAttachments,
  m.hasFileAttachments AS hasFileAttachments,
  c.name AS chat_name,
  c.type AS chat_type,
  c.profileFullName AS chat_profileFullName,
  c.profileName AS chat_profileName,
  c.e164 AS chat_e164,
  s.name AS sender_name,
  s.profileFullName AS sender_profileFullName,
  s.profileName AS sender_profileName,
  s.e164 AS sender_e164
`;

export const MESSAGE_FROM = `
  FROM messages m
  JOIN conversations c ON c.id = m.conversationId
  LEFT JOIN conversations s ON s.serviceId = m.sourceServiceId
`;

export function buildMessageWhere(
  filters: MessageFilters & ScopeFilters,
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.exclude_system) {
    clauses.push(`m.type IN ('incoming','outgoing')`);
  }
  if (filters.only_with_body) {
    clauses.push(`m.body IS NOT NULL AND m.body <> ''`);
  }
  if (filters.sender === 'me') {
    clauses.push(`m.type = 'outgoing'`);
  } else if (filters.sender === 'them') {
    clauses.push(`m.type = 'incoming'`);
  }

  const sinceMs = isoToMs(filters.since);
  if (sinceMs !== undefined) {
    clauses.push(`m.received_at >= ?`);
    params.push(sinceMs);
  }
  const untilMs = isoToMs(filters.until);
  if (untilMs !== undefined) {
    clauses.push(`m.received_at < ?`);
    params.push(untilMs);
  }

  if (filters.chat_ids && filters.chat_ids.length > 0) {
    const placeholders = filters.chat_ids.map(() => '?').join(',');
    clauses.push(`m.conversationId IN (${placeholders})`);
    params.push(...filters.chat_ids);
  }

  if (filters.chat_name_contains) {
    clauses.push(
      `(LOWER(c.name) LIKE ? OR LOWER(c.profileFullName) LIKE ? OR LOWER(c.profileName) LIKE ? OR LOWER(c.e164) LIKE ?)`,
    );
    const like = `%${filters.chat_name_contains.toLowerCase()}%`;
    params.push(like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}
