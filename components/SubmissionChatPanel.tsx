import { headers } from 'next/headers'
import Link from 'next/link'
import { prisma } from '@/lib/db/prisma'
import { listConversationsByEmail } from '@/modules/live-chat/lib/db'

// Rendered on contact-form's submission detail page via the
// "contact-form.submission-detail" extension point: the same person's live
// chats, matched by email. Reading the submission's email from cf_ follows the
// reply-catcher precedent (one-way read, contact-form's schema untouched).
export async function SubmissionChatPanel({ submissionId }: { submissionId: string }) {
  const rows = await prisma.$queryRaw<Array<{ email: string | null }>>`
    SELECT "email" FROM "cf_contact_submissions" WHERE "id" = ${submissionId} LIMIT 1
  `.catch(() => [])
  const email = rows[0]?.email
  if (!email) return null

  const conversations = await listConversationsByEmail(email, 8).catch(() => [])
  if (conversations.length === 0) return null

  const adminPath = (await headers()).get('x-cactus-admin-path') ?? ''

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
        Live chats with this person
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {conversations.map((c) => (
          <Link key={c.id} href={`/${adminPath}/m/live-chat/inbox`}
            style={{ fontSize: '0.8125rem', color: 'inherit', display: 'flex', justifyContent: 'space-between', gap: '0.75rem', textDecoration: 'none' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.status === 'open' ? '🟢' : '✅'} {c.lastMessagePreview || `Conversation #${c.id}`}
            </span>
            <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
              {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleDateString('en-GB') : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
