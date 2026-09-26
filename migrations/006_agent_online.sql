-- Whether anyone is on the chat, kept on the site's own side.
--
-- Every page on the site asks the loader's boot endpoint whether to show the
-- online or the away bubble. That used to be answered by asking the chat
-- server, which woke it from sleep on every page view - bots included - so it
-- never slept at all and ran up the hosting bill around the clock. The answer
-- now lives here: written when an agent flips the Online/Offline switch (the
-- chat server is awake for that anyway), read by every page for free.
--
-- NULL means "never recorded yet" - an install updating onto this file. The
-- first page to find it NULL asks the chat server once and stores the answer.
ALTER TABLE "lc_settings" ADD COLUMN IF NOT EXISTS "agent_online" BOOLEAN;
ALTER TABLE "lc_settings" ADD COLUMN IF NOT EXISTS "agent_online_at" TIMESTAMPTZ;
