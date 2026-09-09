import { visitorCardStatuses, type VisitorCardInventoryItem, type VisitorCardStatus } from "@/domain/admin"

export interface VisitorCardFilters {
  search: string
  status: "all" | VisitorCardStatus
}

export function hasActiveVisitorCardFilters(filters: VisitorCardFilters) {
  return Boolean(filters.search.trim() || filters.status !== "all")
}

export function filterVisitorCards(cards: VisitorCardInventoryItem[], filters: VisitorCardFilters): VisitorCardInventoryItem[] {
  const search = filters.search.trim().toLowerCase()
  return cards.filter((card) =>
    (filters.status === "all" || card.status === filters.status)
    && (!search || card.cardNumber.trim().toLowerCase().includes(search)),
  )
}

export function parseVisitorCardFilters(searchParams: URLSearchParams): VisitorCardFilters {
  const status = searchParams.get("cardStatus")
  return {
    search: searchParams.get("cardQ") ?? "",
    status: (visitorCardStatuses as readonly string[]).includes(status ?? "") ? status as VisitorCardStatus : "all",
  }
}

export function updateVisitorCardFilterSearchParams(current: URLSearchParams, key: "cardQ" | "cardStatus", value: string) {
  const next = new URLSearchParams(current)
  if (!value || value === "all") next.delete(key)
  else next.set(key, value)
  return next
}

export function clearVisitorCardFilterSearchParams(current: URLSearchParams) {
  const next = new URLSearchParams(current)
  next.delete("cardQ")
  next.delete("cardStatus")
  return next
}
