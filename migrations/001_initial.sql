-- live-chat module: initial schema.
-- Mirror of the Chatwoot server's conversations/messages (fed by its webhooks)
-- plus module settings and per-admin agent tokens. The mirror is what the
-- admin inbox lists and polls; Chatwoot itself stays the source of truth.

CREATE TABLE IF NOT EXISTS "lc_settings" (
  "id" TEXT PRIMARY KEY DEFAULT 'singleton',
  "server_url" TEXT,
  "account_id" INTEGER,
  "inbox_id" INTEGER,
  "website_token" TEXT,
  "hmac_token_encrypted" TEXT,
  "api_token_encrypted" TEXT,
  "webhook_token" TEXT,
  "fly_app" TEXT,
  "fly_token_encrypted" TEXT,
  "backup_endpoint" TEXT,
  "backup_token_encrypted" TEXT,
  "widget_position" TEXT NOT NULL DEFAULT 'right',
  "widget_label" TEXT NOT NULL DEFAULT 'Chat with us',
  "reply_time_text" TEXT NOT NULL DEFAULT 'We usually reply within a few hours',
  "retention_months" INTEGER NOT NULL DEFAULT 12,
  "provision_state" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "lc_conversations" (
  "id" INTEGER PRIMARY KEY,
  "contact_email" TEXT,
  "contact_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "assignee_name" TEXT,
  "unread_for_agents" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMPTZ,
  "last_message_preview" TEXT,
  "meta" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "lc_conversations_status_idx"
  ON "lc_conversations" ("status", "last_message_at" DESC);
CREATE INDEX IF NOT EXISTS "lc_conversations_email_idx"
  ON "lc_conversations" ("contact_email");

CREATE TABLE IF NOT EXISTS "lc_messages" (
  "id" BIGINT PRIMARY KEY,
  "conversation_id" INTEGER NOT NULL REFERENCES "lc_conversations"("id") ON DELETE CASCADE,
  "sender_type" TEXT NOT NULL DEFAULT 'contact',
  "sender_name" TEXT,
  "content" TEXT,
  "attachments" JSONB,
  "is_private" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "lc_messages_conversation_idx"
  ON "lc_messages" ("conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "lc_admin_tokens" (
  "user_id" TEXT PRIMARY KEY,
  "agent_token_encrypted" TEXT,
  "chatwoot_agent_id" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
