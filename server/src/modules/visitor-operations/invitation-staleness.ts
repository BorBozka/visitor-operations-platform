/**
 * Stale-`SENDING` invitation recovery (NEW-9).
 *
 * `prepareInvitation` commits `SENDING` before the SMTP call runs, and `finishInvitation` writes
 * `SENT`/`FAILED` after it returns. A process that dies in between leaves the Visit persisted as
 * `SENDING` forever, and the send path skips `SENDING` to avoid duplicate mail — so the record is
 * permanently unsendable. The recovery is to let a *manual* send/resend re-claim a `SENDING`
 * record once its attempt is old enough that no real attempt can still be running. Nothing
 * reclaims automatically: there is no startup or background resend, because a crash between the
 * SMTP accept and the `SENT` write makes re-sending ambiguous, and only an operator can decide a
 * second email is acceptable.
 */

/**
 * How long an invitation may sit in `SENDING` before a manual send/resend may re-claim it.
 *
 * The value has to clear the slowest attempt that can still be genuinely in flight. Nodemailer's
 * default socket timeout is 10 minutes, so an SMTP call can legitimately occupy `SENDING` that
 * long before it throws and writes `FAILED`; 15 minutes sits comfortably past that while staying
 * far below a shift, so an operator is never blocked for long. This is an internal operational
 * contract, not a user-facing setting — the one place the threshold is defined.
 */
export const INVITATION_SEND_STALE_AFTER_MS = 15 * 60_000

/** The instant at or before which a `SENDING` claim counts as abandoned. */
export function invitationSendStaleBefore(now: Date): Date {
  return new Date(now.getTime() - INVITATION_SEND_STALE_AFTER_MS)
}

/**
 * Is this `SENDING` record recoverable? A missing start timestamp reads as stale: only a claim
 * writes that column, so a `SENDING` row without one predates the column and is exactly the
 * permanently stuck state this recovery exists to unblock.
 */
export function isInvitationSendStale(invitationStatus: string, sendStartedAt: Date | null | undefined, now: Date): boolean {
  if (invitationStatus !== "SENDING") return false
  return !sendStartedAt || sendStartedAt.getTime() <= invitationSendStaleBefore(now).getTime()
}
