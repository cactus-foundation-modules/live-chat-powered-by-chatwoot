import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'

// Chatwoot "Dashboard App": an iframe panel inside the Chatwoot conversation
// view. Chatwoot posts the conversation context to the iframe via postMessage;
// this page picks out the contact's email and shows their contact-form
// history, so whoever is answering in Chatwoot (or the mobile app's web view)
// sees what this person has already sent through the site.
//
// Access: the iframe URL carries the webhook token - same trust level as the
// webhook (server-to-server secret configured by us on the Chatwoot side).
export async function GET(request: NextRequest) {
  const config = await getLiveChatConfig()
  const token = request.nextUrl.searchParams.get('token') ?? ''
  if (!config.webhookToken || token !== config.webhookToken) {
    return new NextResponse('Not found', { status: 404 })
  }

  const email = request.nextUrl.searchParams.get('email')
  if (email) {
    // Second hop: the page's own script calls back with the email it got from
    // postMessage, and we return the rendered history fragment.
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id", "subject", "message", "createdAt" FROM "cf_contact_submissions"
      WHERE lower("email") = lower(${email})
      ORDER BY "createdAt" DESC LIMIT 10
    `.catch(() => [])
    return NextResponse.json({
      submissions: rows.map((r) => ({
        id: String(r.id),
        subject: (r.subject as string | null) ?? '(no subject)',
        preview: String(r.message ?? '').slice(0, 160),
        at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })),
    })
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui,sans-serif;font-size:13px;margin:12px;color:#1f2933}
    .card{border:1px solid #e0e5eb;border-radius:8px;padding:8px 10px;margin-bottom:8px}
    .sub{color:#66788a;font-size:11px}
    h4{margin:0 0 8px;font-size:13px}
  </style></head><body>
  <h4>Contact form history</h4>
  <div id="out" class="sub">Waiting for conversation…</div>
  <script>
    window.addEventListener('message', async function (ev) {
      var data = ev.data;
      try { if (typeof data === 'string') data = JSON.parse(data); } catch (e) { return; }
      if (!data || data.event !== 'appContext') return;
      var email = data.data && data.data.contact && data.data.contact.email;
      var out = document.getElementById('out');
      if (!email) { out.textContent = 'No email on this contact yet.'; return; }
      out.textContent = 'Loading…';
      try {
        var res = await fetch(location.pathname + location.search + '&email=' + encodeURIComponent(email));
        var json = await res.json();
        if (!json.submissions || !json.submissions.length) { out.textContent = 'No contact-form messages from ' + email + '.'; return; }
        out.className = '';
        out.innerHTML = json.submissions.map(function (s) {
          return '<div class="card"><div><strong>' + s.subject.replace(/[<>&]/g, '') + '</strong></div>' +
            '<div>' + s.preview.replace(/[<>&]/g, '') + '</div>' +
            '<div class="sub">' + new Date(s.at).toLocaleString('en-GB') + '</div></div>';
        }).join('');
      } catch (e) { out.textContent = 'Could not load history.'; }
    });
    window.parent.postMessage('chatwoot-dashboard-app:fetch-info', '*');
  </script></body></html>`
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
