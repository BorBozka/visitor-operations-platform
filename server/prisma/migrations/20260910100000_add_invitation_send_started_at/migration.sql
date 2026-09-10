-- Dates the current invitation send attempt (the NOT_SENT/FAILED -> SENDING transition) so a
-- manual send/resend can tell an in-flight attempt from one a process restart abandoned.
-- Nullable with no backfill on purpose: rows already stuck in SENDING predate the column and
-- read as stale, which is exactly the state this recovery has to unblock.
ALTER TABLE [dbo].[Visit] ADD [invitationSendStartedAt] DATETIME2;
