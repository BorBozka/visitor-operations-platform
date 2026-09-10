import type { Visit } from "@/domain/visits"

type InvitationSendResult = Pick<Visit, "invitationError" | "invitationStatus">

export type InvitationSendFeedback =
  | { kind: "info"; message: string }
  | { kind: "error"; message: string }
  | { kind: "mixed"; message: string }
  | { kind: "success"; message: string }

export function getInvitationSendFeedback(results: InvitationSendResult[]): InvitationSendFeedback {
  if (results.length === 0) return { kind: "info", message: "Gönderilecek davet bulunamadı." }

  const failed = results.filter((item) => item.invitationStatus === "FAILED")
  const sent = results.filter((item) => item.invitationStatus === "SENT")
  if (failed.length > 0) {
    const message = sent.length > 0
      ? `${sent.length} davet gönderildi; ${failed.length} davet gönderilemedi.`
      : failed[0].invitationError ?? "Davet gönderilemedi."
    return { kind: sent.length > 0 ? "mixed" : "error", message }
  }

  return {
    kind: "success",
    message: results.length > 1 ? `${sent.length} davet başarıyla gönderildi.` : "Davet başarıyla gönderildi.",
  }
}
