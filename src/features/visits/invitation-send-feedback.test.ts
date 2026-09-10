import { describe, expect, it } from "vitest"

import { getInvitationSendFeedback } from "@/features/visits/invitation-send-feedback"

describe("getInvitationSendFeedback", () => {
  it("shows informational feedback instead of success when a stale pending action sends no invitations", () => {
    expect(getInvitationSendFeedback([])).toEqual({
      kind: "info",
      message: "Gönderilecek davet bulunamadı.",
    })
  })

  it("keeps the singular success message", () => {
    expect(getInvitationSendFeedback([{ invitationStatus: "SENT", invitationError: undefined }])).toEqual({
      kind: "success",
      message: "Davet başarıyla gönderildi.",
    })
  })

  it("keeps the count success message", () => {
    expect(getInvitationSendFeedback([
      { invitationStatus: "SENT", invitationError: undefined },
      { invitationStatus: "SENT", invitationError: undefined },
    ])).toEqual({
      kind: "success",
      message: "2 davet başarıyla gönderildi.",
    })
  })

  it("keeps failure feedback", () => {
    expect(getInvitationSendFeedback([{ invitationStatus: "FAILED", invitationError: "SMTP ulaşılamadı." }])).toEqual({
      kind: "error",
      message: "SMTP ulaşılamadı.",
    })
  })

  it("keeps mixed send and failure feedback", () => {
    expect(getInvitationSendFeedback([
      { invitationStatus: "SENT", invitationError: undefined },
      { invitationStatus: "FAILED", invitationError: "SMTP ulaşılamadı." },
    ])).toEqual({
      kind: "mixed",
      message: "1 davet gönderildi; 1 davet gönderilemedi.",
    })
  })
})
