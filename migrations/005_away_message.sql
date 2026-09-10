-- Two halves of one complaint: a visitor who opens the chat while the owner is
-- away was told "Typically replies in a few minutes", and nothing else in the
-- panel let on that nobody was there.
--
-- away_message is the owner's own wording for that moment. It is handed to the
-- widget as its unavailable message, and doubles as the bubble's tooltip, so
-- there is one sentence to edit rather than two.
ALTER TABLE "lc_settings" ADD COLUMN IF NOT EXISTS "away_message" TEXT NOT NULL
  DEFAULT 'We are away at the moment - leave a message here and we will email you back.';

-- Chatwoot creates a default Mon-Fri 9-5 business-hours row set on every new
-- inbox and leaves it there even when business hours are switched off. Its
-- widget then reads those rows first and prints the reply time whenever the
-- clock is inside them, whatever the agent's actual availability - which is
-- exactly the wrong line to show someone at 11am on a day nobody is on. The
-- rows cannot be deleted through Chatwoot's API, only rewritten, so the module
-- marks every day closed instead (harmless while business hours are off) and
-- records here that it has done so, so it is a one-off rather than a call on
-- every page.
ALTER TABLE "lc_settings" ADD COLUMN IF NOT EXISTS "working_hours_closed" BOOLEAN NOT NULL DEFAULT false;
