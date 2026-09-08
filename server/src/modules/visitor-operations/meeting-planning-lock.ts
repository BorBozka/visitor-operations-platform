import { ApiError } from "../../lib/api-error.js"

/**
 * Planning fields that live on the Meeting (time window, host, company/facility, visit type and
 * the rest of the shared meeting edit payload) are common to every Visit of that Meeting, so a
 * single change rewrites the plan of every visitor in the group. They may therefore only be
 * mutated while the whole group is still PLANNED: one CHECKED_IN / CHECKED_OUT / CANCELLED /
 * NO_SHOW Visit locks the shared planning of the Meeting.
 *
 * This is the single definition of the invariant. The service applies it to the snapshot it
 * loaded, and the repository re-applies it to the rows it reads inside the write transaction so
 * a status change that lands in between cannot break it.
 */
export function assertMeetingPlanningUnlocked(visitStatuses: readonly string[]): void {
  if (visitStatuses.some((status) => status !== "PLANNED")) {
    throw new ApiError(
      409,
      "MEETING_VISITS_NOT_PLANNED",
      "Toplantıdaki tüm ziyaretler planlı olmadığı için ortak planlama alanları değiştirilemez.",
    )
  }
}
