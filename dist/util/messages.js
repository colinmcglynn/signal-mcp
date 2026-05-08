import { msToIso } from './time.js';
export function chatDisplayName(row) {
    return (row.chat_name ||
        row.chat_profileFullName ||
        row.chat_profileName ||
        row.chat_e164 ||
        '(unknown)');
}
export function senderDisplayName(row) {
    if (row.type === 'outgoing')
        return 'me';
    return (row.sender_profileFullName ||
        row.sender_profileName ||
        row.sender_name ||
        row.sender_e164 ||
        row.sourceServiceId ||
        '(unknown)');
}
export function direction(row) {
    if (row.type === 'incoming')
        return 'incoming';
    if (row.type === 'outgoing')
        return 'outgoing';
    return 'system';
}
export function toMessageOut(row) {
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
//# sourceMappingURL=messages.js.map