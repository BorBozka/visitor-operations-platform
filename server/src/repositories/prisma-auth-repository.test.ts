import type { PrismaClient } from "@prisma/client"
import { describe, expect, it } from "vitest"

import { PrismaAuthRepository } from "./prisma-auth-repository.js"

interface State {
  passwordHash: string
  sessions: { userId: string; tokenHash: string; revokedAt: Date | null }[]
}

function createTransactionalPrisma() {
  let state: State = {
    passwordHash: "old-hash",
    sessions: [
      { userId: "user-1", tokenHash: "session-a-hash", revokedAt: null },
      { userId: "user-1", tokenHash: "session-b-hash", revokedAt: null },
      { userId: "other-user", tokenHash: "other-session-hash", revokedAt: null },
    ],
  }
  let failure: "password" | "revoke" | null = null
  const transactionOptions: unknown[] = []

  const prisma = {
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>, options: unknown) => {
      transactionOptions.push(options)
      const draft = structuredClone(state)
      const transaction = {
        user: {
          update: async ({ where, data }: { where: { id: string }; data: { passwordHash: string } }) => {
            if (where.id !== "user-1" || failure === "password") throw new Error("Password update failed")
            draft.passwordHash = data.passwordHash
          },
        },
        session: {
          updateMany: async ({ where, data }: { where: { userId: string; revokedAt: null; tokenHash?: { not: string } }; data: { revokedAt: Date } }) => {
            draft.sessions = draft.sessions.map((session) => session.userId === where.userId && session.revokedAt === null && session.tokenHash !== where.tokenHash?.not
              ? { ...session, revokedAt: data.revokedAt }
              : session)
            if (failure === "revoke") throw new Error("Session revoke failed")
          },
        },
      }
      const result = await operation(transaction)
      state = draft
      return result
    },
  }

  return {
    prisma: prisma as unknown as PrismaClient,
    state: () => structuredClone(state),
    failAt: (stage: "password" | "revoke") => { failure = stage },
    transactionOptions,
  }
}

describe("PrismaAuthRepository password/session transaction", () => {
  it("updates the password and revokes every other session in one Serializable transaction", async () => {
    const fake = createTransactionalPrisma()
    const revokedAt = new Date("2026-09-08T10:00:00.000Z")

    await new PrismaAuthRepository(fake.prisma).updatePasswordAndRevokeSessions({
      userId: "user-1",
      passwordHash: "new-hash",
      revokedAt,
      exceptSessionTokenHash: "session-a-hash",
    })

    expect(fake.state()).toEqual({
      passwordHash: "new-hash",
      sessions: [
        { userId: "user-1", tokenHash: "session-a-hash", revokedAt: null },
        { userId: "user-1", tokenHash: "session-b-hash", revokedAt },
        { userId: "other-user", tokenHash: "other-session-hash", revokedAt: null },
      ],
    })
    expect(fake.transactionOptions).toEqual([{ isolationLevel: "Serializable" }])
  })

  it("revokes all of the user's sessions when no exclusion is supplied", async () => {
    const fake = createTransactionalPrisma()
    const revokedAt = new Date("2026-09-08T10:00:00.000Z")

    await new PrismaAuthRepository(fake.prisma).updatePasswordAndRevokeSessions({ userId: "user-1", passwordHash: "new-hash", revokedAt })

    expect(fake.state().sessions.filter((session) => session.userId === "user-1")).toEqual([
      { userId: "user-1", tokenHash: "session-a-hash", revokedAt },
      { userId: "user-1", tokenHash: "session-b-hash", revokedAt },
    ])
  })

  it.each(["password", "revoke"] as const)("rolls back both sides when the %s write fails", async (stage) => {
    const fake = createTransactionalPrisma()
    const before = fake.state()
    fake.failAt(stage)

    await expect(new PrismaAuthRepository(fake.prisma).updatePasswordAndRevokeSessions({
      userId: "user-1",
      passwordHash: "new-hash",
      revokedAt: new Date("2026-09-08T10:00:00.000Z"),
    })).rejects.toThrow()

    expect(fake.state()).toEqual(before)
  })
})
