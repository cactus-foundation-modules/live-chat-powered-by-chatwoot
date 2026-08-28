import { describe, expect, it, vi, beforeEach } from 'vitest'

// Chats, in the shape core asks for when it puts several channels in one list.
//
// The part worth guarding hardest is the reply: it goes out through Chatwoot
// with the acting person's own agent token, so the customer gets a genuine
// reply from a colleague with a name. Somebody who has never connected their
// account is told exactly that - posting as somebody else instead would be a
// forgery, and "something went wrong" would leave them nothing to do about it.

const clearUnread = vi.hoisted(() => vi.fn())
const getAgentToken = vi.hoisted(() => vi.fn())
const getConversation = vi.hoisted(() => vi.fn())
const listConversationSummaries = vi.hoisted(() => vi.fn())
const listConversationsByEmails = vi.hoisted(() => vi.fn())
const listMessages = vi.hoisted(() => vi.fn())
const markConversationRead = vi.hoisted(() => vi.fn())
const sendMessage = vi.hoisted(() => vi.fn())

vi.mock('./db', () => ({
  clearUnread,
  getAgentToken,
  getConversation,
  listConversationSummaries,
  listConversationsByEmails,
  listMessages,
}))
vi.mock('./chatwoot', () => ({ markConversationRead, sendMessage }))

const { liveChatConversationProvider: provider } = await import('./conversation-provider')

const chat = {
  id: 7,
  contactEmail: 'ada@example.com',
  contactName: 'Ada Lovelace',
  status: 'open',
  assigneeName: null,
  unreadForAgents: 2,
  lastMessageAt: new Date('2026-08-27T15:00:00Z'),
  lastMessagePreview: 'Are the black ones in stock?',
  meta: null,
}

beforeEach(() => {
  clearUnread.mockReset().mockResolvedValue(undefined)
  getAgentToken.mockReset().mockResolvedValue('agent-token')
  getConversation.mockReset().mockResolvedValue(chat)
  listConversationSummaries.mockReset().mockResolvedValue([chat])
  listConversationsByEmails.mockReset().mockResolvedValue([chat])
  listMessages.mockReset().mockResolvedValue([])
  markConversationRead.mockReset().mockResolvedValue(undefined)
  sendMessage.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('listing', () => {
  it('describes a chat the way a merged list needs it', async () => {
    const page = await provider.list({ limit: 25 })
    expect(page.items[0]).toEqual({
      id: '7',
      channel: 'chat',
      subject: 'Chat with Ada Lovelace',
      preview: 'Are the black ones in stock?',
      participant: { name: 'Ada Lovelace', email: 'ada@example.com', phone: null },
      lastMessageAt: chat.lastMessageAt,
      unread: true,
      status: 'open',
      href: 'inbox?tab=live-chat',
    })
  })

  it('says a resolved chat is closed', async () => {
    listConversationSummaries.mockResolvedValue([{ ...chat, status: 'resolved', unreadForAgents: 0 }])
    expect((await provider.list({ limit: 25 })).items[0]).toMatchObject({
      status: 'closed',
      unread: false,
    })
  })

  it('offers a cursor only when the page was full', async () => {
    expect((await provider.list({ limit: 25 })).nextCursor).toBeUndefined()
    expect((await provider.list({ limit: 1 })).nextCursor).toBe(chat.lastMessageAt.toISOString())
  })
})

describe('one conversation', () => {
  it('tells a customer’s message, an agent’s reply and a private note apart', async () => {
    listMessages.mockResolvedValue([
      { id: 1, conversationId: 7, senderType: 'contact', senderName: 'Ada', content: 'Hello?', attachments: null, isPrivate: false, createdAt: new Date('2026-08-27T14:00:00Z') },
      { id: 2, conversationId: 7, senderType: 'user', senderName: 'Marcus', content: 'Hello!', attachments: null, isPrivate: false, createdAt: new Date('2026-08-27T14:05:00Z') },
      { id: 3, conversationId: 7, senderType: 'user', senderName: 'Marcus', content: 'Checking stock', attachments: null, isPrivate: true, createdAt: new Date('2026-08-27T14:06:00Z') },
    ])
    const thread = await provider.thread('7')
    expect(thread!.messages.map((m) => m.direction)).toEqual(['in', 'out', 'note'])
  })

  it('carries attachments over with a filename somebody can read', async () => {
    listMessages.mockResolvedValue([
      {
        id: 1,
        conversationId: 7,
        senderType: 'contact',
        senderName: 'Ada',
        content: '',
        attachments: [{ data_url: 'https://chat.example/files/floor%20plan.pdf?token=x', file_type: 'file' }],
        isPrivate: false,
        createdAt: new Date('2026-08-27T14:00:00Z'),
      },
    ])
    const thread = await provider.thread('7')
    expect(thread!.messages[0]!.attachments).toEqual([
      {
        filename: 'floor plan.pdf',
        url: 'https://chat.example/files/floor%20plan.pdf?token=x',
        contentType: 'file',
      },
    ])
  })

  it('is null for an id that is not a chat', async () => {
    expect(await provider.thread('not-a-number')).toBeNull()
    expect(getConversation).not.toHaveBeenCalled()
  })
})

describe('replying', () => {
  it('sends as the person who wrote it', async () => {
    await provider.send!('7', { text: 'They are, yes.', authorUserId: 'u1' })
    expect(getAgentToken).toHaveBeenCalledWith('u1')
    expect(sendMessage).toHaveBeenCalledWith(7, 'They are, yes.', { token: 'agent-token' })
    expect(clearUnread).toHaveBeenCalledWith(7)
  })

  it('refuses, in a sentence with the fix in it, when they have not connected their account', async () => {
    getAgentToken.mockResolvedValue(null)
    await expect(provider.send!('7', { text: 'hello', authorUserId: 'u1' })).rejects.toThrow(
      /connected your live chat account.*Settings, Live Chat/s,
    )
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('marking read', () => {
  it('clears it here even when the far end will not have it', async () => {
    markConversationRead.mockRejectedValue(new Error('Chatwoot 502'))
    await expect(provider.markRead!('7')).resolves.toBeUndefined()
    expect(clearUnread).toHaveBeenCalledWith(7)
  })
})
