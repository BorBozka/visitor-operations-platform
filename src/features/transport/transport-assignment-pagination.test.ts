import { describe, expect, it } from "vitest"

import type { PlannedTransportAssignment } from "@/domain/transport-assignments"
import {
  getTransportPageCount,
  getVisibleTransportPageNumbers,
  paginateTransportAssignments,
  TRANSPORT_PAGE_SIZE,
} from "@/features/transport/transport-assignment-pagination"

const assignments = Array.from({ length: 153 }, (_, index) => ({ id: `assignment-${index}` })) as PlannedTransportAssignment[]

describe("planned transport assignment pagination", () => {
  it("shows five assignments per page", () => {
    expect(TRANSPORT_PAGE_SIZE).toBe(5)
    expect(assignments).toHaveLength(153)
    expect(paginateTransportAssignments(assignments, 1)).toHaveLength(5)
    expect(paginateTransportAssignments(assignments, 2)).toHaveLength(5)
    expect(paginateTransportAssignments(assignments, 31)).toHaveLength(3)
    expect(getTransportPageCount(assignments.length)).toBe(31)
  })

  it("returns only real page-number controls", () => {
    expect(getVisibleTransportPageNumbers(1, 4)).toEqual([1, 2, 3])
    expect(getVisibleTransportPageNumbers(4, 4)).toEqual([2, 3, 4])
    expect(getVisibleTransportPageNumbers(3, 5)).toEqual([2, 3, 4])
  })

  it("keeps pagination stable for an empty list", () => {
    expect(getTransportPageCount(0)).toBe(1)
    expect(paginateTransportAssignments([] as PlannedTransportAssignment[], 1)).toEqual([])
  })
})
