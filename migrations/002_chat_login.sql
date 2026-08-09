-- The chat server's own login (created by the provisioning wizard, or noted by
-- a centrally managed install) so the settings page can always show the owner
-- what the phone app signs in with. Password encrypted with the site's
-- ENCRYPTION_KEY, revealed only behind livechat.manage.
ALTER TABLE "lc_settings" ADD COLUMN IF NOT EXISTS "chat_login_email" TEXT;
ALTER TABLE "lc_settings" ADD COLUMN IF NOT EXISTS "chat_login_password_encrypted" TEXT;
