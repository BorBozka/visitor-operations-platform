import type { Visit } from "@/domain/visits"

type InvitationSendResult = Pick<Visit, "invitationError" | "invitationStatus">

export type InvitationSendFeedback =
  | { kind: "info"; message: string }
  | { kind: "error"; message: string }
  | { kind: "mixed"; message: string }
  | { kind: "success"; message: string }

// Only an exact `SENT` is a delivered invitation and only an exact `FAILED` is a delivery failure.
// A result still reading `SENDING` describes an attempt some *other* request holds the claim on —
// nothing was mailed on this one's behalf — so it counts towards neither tally, and a batch made
// up entirely of such results is reported the same way an empty batch is: nothing was sent.
export function getInvitationSendFeedback(results: InvitationSendResult[]): InvitationSendFeedback {
  const failed = results.filter((item) => item.invitationStatus === "FAILED")
  const sent = results.filter((item) => item.invitationStatus === "SENT")
  if (failed.length === 0 && sent.length === 0) return { kind: "info", message: "Gönderilecek davet bulunamadı." }

  if (failed.length > 0) {
    const message = sent.length > 0
      ? `${sent.length} davet gönderildi; ${failed.length} davet gönderilemedi.`
      : failed[0].invitationError ?? "Davet gönderilemedi."
    return { kind: sent.length > 0 ? "mixed" : "error", message }
  }

  return {
    kind: "success",
    message: sent.length > 1 ? `${sent.length} davet başarıyla gönderildi.` : "Davet başarıyla gönderildi.",
  }
}
