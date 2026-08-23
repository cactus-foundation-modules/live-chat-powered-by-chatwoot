-- Phones have less room than the bubble's copy assumes: on a narrow screen the
-- pill can sit over add-to-basket buttons and filter bars. This switch drops
-- the bubble to its icon alone below the mobile breakpoint, leaving the desktop
-- pill exactly as it was. Off by default, so nothing changes until it is asked for.
ALTER TABLE "lc_settings" ADD COLUMN IF NOT EXISTS "hide_label_on_mobile" BOOLEAN NOT NULL DEFAULT false;
