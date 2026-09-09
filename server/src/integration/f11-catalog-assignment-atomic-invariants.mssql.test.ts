import "dotenv/config"

import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { NewAssignment } from "../modules/resource-assignments/conflicts.js"
import { ResourceService } from "../modules/resources/service.js"
import type { ResourceInput } from "../modules/resources/types.js"
import { PrismaResourceRepository } from "../repositories/prisma-resource-repository.js"
import { PrismaResourceAssignmentRepository } from "../repositories/resource-assignment-repository.js"
import { PrismaTransportAssignmentRepository, type PersistTransportAssignmentInput } from "../repositories/transport-assignment-repository.js"

const describeMssql = process.env.RUN_MSSQL_INTEGRATION === "true" ? describe : describe.skip

describeMssql.sequential("F11 MSSQL — catalog and assignment atomic invariants", () => {
  const prisma = new PrismaClient()
  const resourceRepository = new PrismaResourceRepository(prisma)
  const resourceService = new ResourceService(resourceRepository)
  const meetingAssignments = new PrismaResourceAssignmentRepository(prisma)
  const transportAssignments = new PrismaTransportAssignmentRepository(prisma)
  const suffix = Date.now().toString().slice(-9)
  const otherCompanyId = `f11-co-${suffix}`
  const otherFacilityId = `f11-fac-${suffix}`
  const resourceIds: string[] = []
  const meetingIds: string[] = []
  const transportIds: string[] = []

  const at = (offsetHours: number) => new Date(Date.UTC(2027, 0, 1, offsetHours)).toISOString()

  const createResource = async (input: ResourceInput) => {
    const resource = await resourceService.create(input)
    resourceIds.push(resource.id)
    return resource
  }

  const createMeeting = async (offsetHours: number) => {
    const meeting = await prisma.meeting.create({
      data: {
        creatorEmployeeId: "maya-kara", visitTypeId: "meeting", hostEmployeeId: "maya-kara",
        hostEmployeeName: "Maya Kara", hostCompanyId: "bplas", facilityId: "bplas-merkez",
        plannedStart: new Date(at(offsetHours)), plannedEnd: new Date(at(offsetHours + 1)),
      },
    })
    meetingIds.push(meeting.id)
    return meeting
  }

  const roomIntent = (id: string): NewAssignment => ({
    resourceId: id, resourceType: "ROOM", resourceName: "STALE",
    companyId: "stale-company", facilityId: "stale-facility", totalQuantity: null, requestedQuantity: null,
  })

  const equipmentIntent = (id: string, requestedQuantity: number): NewAssignment => ({
    resourceId: id, resourceType: "POOLED_EQUIPMENT", resourceName: "STALE",
    companyId: "stale-company", facilityId: "stale-facility", totalQuantity: 999, requestedQuantity,
  })

  const transportInput = (vehicleResourceId: string, driverResourceId: string, offsetHours: number): PersistTransportAssignmentInput => ({
    companyId: "bplas", facilityId: "bplas-merkez", plannedStart: at(offsetHours), plannedEnd: at(offsetHours + 1),
    purpose: `F11 taşıma ${suffix}`, vehicleResourceId, vehicleName: "STALE VEHICLE", vehicleLicensePlate: "STALE",
    driverResourceId, driverName: "STALE DRIVER",
  })

  beforeAll(async () => {
    await prisma.company.create({ data: { id: otherCompanyId, name: `F11 Şirket ${suffix}`, nameNormalized: `F11 SIRKET ${suffix}` } })
    await prisma.facility.create({ data: { id: otherFacilityId, companyId: otherCompanyId, name: `F11 Tesis ${suffix}`, nameNormalized: `F11 TESIS ${suffix}` } })
  })

  afterAll(async () => {
    if (meetingIds.length > 0) await prisma.resourceAssignment.deleteMany({ where: { meetingId: { in: meetingIds } } })
    if (transportIds.length > 0) await prisma.transportAssignment.deleteMany({ where: { id: { in: transportIds } } })
    if (meetingIds.length > 0) await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } })
    if (resourceIds.length > 0) {
      await prisma.driverLicenseClass.deleteMany({ where: { resourceId: { in: resourceIds } } })
      await prisma.driverDocument.deleteMany({ where: { resourceId: { in: resourceIds } } })
      await prisma.resource.deleteMany({ where: { id: { in: resourceIds } } })
    }
    await prisma.facility.deleteMany({ where: { id: otherFacilityId } })
    await prisma.company.deleteMany({ where: { id: otherCompanyId } })
    await prisma.$disconnect()
  })

  it("enforces normalized plate uniqueness sequentially while allowing another company", async () => {
    const plate = `34 f11 s ${suffix}`
    await createResource({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Ford", model: "Transit", licensePlate: plate })

    await expect(createResource({
      type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Fiat", model: "Doblo",
      licensePlate: `  ${plate.toUpperCase().replaceAll(" ", "  ")}  `,
    })).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_LICENSE_PLATE" })
    await expect(createResource({
      type: "VEHICLE", companyId: otherCompanyId, facilityId: otherFacilityId, brand: "Ford", model: "Transit", licensePlate: plate,
    })).resolves.toMatchObject({ licensePlate: plate.toUpperCase() })
  })

  it("lets exactly one concurrent create win for the same company and normalized plate", async () => {
    const input = {
      type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Ford", model: "Transit",
      licensePlate: `34 F11 C ${suffix}`,
    } satisfies ResourceInput
    const results = await Promise.allSettled([resourceRepository.save(input), resourceRepository.save(input)])
    const winners = results.filter((result) => result.status === "fulfilled")
    const losers = results.filter((result) => result.status === "rejected")
    for (const result of winners) if (result.status === "fulfilled") resourceIds.push(result.value.id)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    if (losers[0]?.status === "rejected") expect(losers[0].reason).toMatchObject({ statusCode: 409, code: "DUPLICATE_LICENSE_PLATE" })
    expect(await prisma.resource.count({ where: { companyId: "bplas", licensePlate: input.licensePlate } })).toBe(1)
  })

  it("prevents concurrent updates from converging on one company plate", async () => {
    const first = await createResource({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Ford", model: "Transit", licensePlate: `34 F11 U1 ${suffix}` })
    const second = await createResource({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Fiat", model: "Doblo", licensePlate: `34 F11 U2 ${suffix}` })
    const targetPlate = `34 F11 UX ${suffix}`
    const results = await Promise.allSettled([
      resourceRepository.save({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Ford", model: "Transit", licensePlate: targetPlate }, first.id),
      resourceRepository.save({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Fiat", model: "Doblo", licensePlate: targetPlate }, second.id),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const loser = results.find((result) => result.status === "rejected")
    if (loser?.status === "rejected") expect(loser.reason).toMatchObject({ statusCode: 409, code: "DUPLICATE_LICENSE_PLATE" })
    expect(await prisma.resource.count({ where: { companyId: "bplas", licensePlate: targetPlate } })).toBe(1)
  })

  it("allows multiple null-plate catalog types under the filtered index", async () => {
    await expect(Promise.all([
      createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Null Oda ${suffix}` }),
      createResource({ type: "POOLED_EQUIPMENT", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Null Ekipman ${suffix}`, totalQuantity: 3 }),
      createResource({ type: "DRIVER", companyId: "bplas", facilityId: "bplas-merkez", fullName: `F11 Null Şoför ${suffix}`, licenseClasses: ["B"], documents: [], canDriveCommercialVehicles: false }),
    ])).resolves.toHaveLength(3)
  })

  it("commits ROOM and equipment snapshots from current transaction state", async () => {
    const room = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Güncel Oda ${suffix}` })
    const equipment = await createResource({ type: "POOLED_EQUIPMENT", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Güncel Ekipman ${suffix}`, totalQuantity: 7 })
    const meeting = await createMeeting(1)

    const committed = await meetingAssignments.commitMeetingAssignments(meeting.id, [roomIntent(room.id), equipmentIntent(equipment.id, 3)])

    expect(committed).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: room.id, resourceName: `F11 Güncel Oda ${suffix}`, companyId: "bplas", facilityId: "bplas-merkez" }),
      expect.objectContaining({ resourceId: equipment.id, resourceName: `F11 Güncel Ekipman ${suffix}`, totalQuantity: 7, requestedQuantity: 3 }),
    ]))
  })

  it("rejects stale inactive, moved, deleted, and reduced-capacity meeting resources", async () => {
    const meeting = await createMeeting(3)
    const inactive = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Pasif Oda ${suffix}` })
    await prisma.resource.update({ where: { id: inactive.id }, data: { active: false } })
    await expect(meetingAssignments.commitMeetingAssignments(meeting.id, [roomIntent(inactive.id)])).rejects.toMatchObject({ code: "RESOURCE_ASSIGNMENT_CONFLICT" })

    const moved = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Taşınmış Oda ${suffix}` })
    await prisma.resource.update({ where: { id: moved.id }, data: { companyId: otherCompanyId, facilityId: otherFacilityId } })
    await expect(meetingAssignments.commitMeetingAssignments(meeting.id, [roomIntent(moved.id)])).rejects.toMatchObject({ code: "RESOURCE_ASSIGNMENT_CONFLICT" })

    const deleted = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Silinmiş Oda ${suffix}` })
    await expect(resourceRepository.delete(deleted.id)).resolves.toBe(true)
    await expect(meetingAssignments.commitMeetingAssignments(meeting.id, [roomIntent(deleted.id)])).rejects.toMatchObject({ code: "RESOURCE_ASSIGNMENT_CONFLICT" })

    const reduced = await createResource({ type: "POOLED_EQUIPMENT", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Azalan Ekipman ${suffix}`, totalQuantity: 5 })
    await prisma.resource.update({ where: { id: reduced.id }, data: { totalQuantity: 1 } })
    await expect(meetingAssignments.commitMeetingAssignments(meeting.id, [equipmentIntent(reduced.id, 2)])).rejects.toMatchObject({ code: "EQUIPMENT_CAPACITY" })
    expect(await prisma.resourceAssignment.count({ where: { meetingId: meeting.id } })).toBe(0)
  })

  it("keeps a valid final state when resource disable races a Meeting assignment", async () => {
    const room = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F11 Yarış Oda ${suffix}` })
    const meeting = await createMeeting(5)

    const results = await Promise.allSettled([
      meetingAssignments.commitMeetingAssignments(meeting.id, [roomIntent(room.id)]),
      resourceRepository.setActive(room.id, false),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const loser = results.find((result) => result.status === "rejected")
    if (loser?.status === "rejected") expect(loser.reason).toMatchObject({ statusCode: 409 })
    const [resource, assignmentCount] = await Promise.all([
      prisma.resource.findUniqueOrThrow({ where: { id: room.id } }),
      prisma.resourceAssignment.count({ where: { meetingId: meeting.id, resourceId: room.id } }),
    ])
    expect(assignmentCount === 0 || resource.active).toBe(true)
    expect(assignmentCount === 1 && !resource.active).toBe(false)
  })

  it("revalidates transport create/update and persists current vehicle/driver snapshots", async () => {
    const vehicle = await createResource({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Ford", model: "Transit", licensePlate: `34 F11 T ${suffix}` })
    const driver = await createResource({ type: "DRIVER", companyId: "bplas", facilityId: "bplas-merkez", fullName: `F11 Şoför ${suffix}`, licenseClasses: ["B"], documents: [], canDriveCommercialVehicles: false })
    const created = await transportAssignments.create(transportInput(vehicle.id, driver.id, 10))
    transportIds.push(created.id)
    expect(created).toMatchObject({ vehicleName: "Ford Transit", vehicleLicensePlate: `34 F11 T ${suffix}`, driverName: `F11 Şoför ${suffix}` })

    await prisma.resource.update({ where: { id: vehicle.id }, data: { brand: "Mercedes", model: "Sprinter" } })
    await prisma.resource.update({ where: { id: driver.id }, data: { fullName: `F11 Güncel Şoför ${suffix}` } })
    const updated = await transportAssignments.update(created.id, { ...transportInput(vehicle.id, driver.id, 12), vehicleName: "STALE", driverName: "STALE" })
    expect(updated).toMatchObject({ vehicleName: "Mercedes Sprinter", vehicleLicensePlate: `34 F11 T ${suffix}`, driverName: `F11 Güncel Şoför ${suffix}` })
  })

  it("rejects stale inactive, moved, and deleted transport resources", async () => {
    const vehicle = await createResource({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Ford", model: "Transit", licensePlate: `34 F11 X ${suffix}` })
    const driver = await createResource({ type: "DRIVER", companyId: "bplas", facilityId: "bplas-merkez", fullName: `F11 X Şoför ${suffix}`, licenseClasses: ["B"], documents: [], canDriveCommercialVehicles: false })

    await prisma.resource.update({ where: { id: vehicle.id }, data: { active: false } })
    await expect(transportAssignments.create(transportInput(vehicle.id, driver.id, 15))).rejects.toMatchObject({ code: "TRANSPORT_ASSIGNMENT_CONFLICT" })
    await prisma.resource.update({ where: { id: vehicle.id }, data: { active: true } })
    await prisma.resource.update({ where: { id: driver.id }, data: { active: false } })
    await expect(transportAssignments.create(transportInput(vehicle.id, driver.id, 17))).rejects.toMatchObject({ code: "TRANSPORT_ASSIGNMENT_CONFLICT" })
    await prisma.resource.update({ where: { id: driver.id }, data: { active: true, companyId: otherCompanyId, facilityId: otherFacilityId } })
    await expect(transportAssignments.create(transportInput(vehicle.id, driver.id, 19))).rejects.toMatchObject({ code: "TRANSPORT_ASSIGNMENT_CONFLICT" })
    await prisma.resource.update({ where: { id: driver.id }, data: { companyId: "bplas", facilityId: "bplas-merkez" } })
    await expect(resourceRepository.delete(driver.id)).resolves.toBe(true)
    await expect(transportAssignments.create(transportInput(vehicle.id, driver.id, 21))).rejects.toMatchObject({ code: "TRANSPORT_ASSIGNMENT_CONFLICT" })
  })

  it("keeps a valid final state when driver disable races a transport create", async () => {
    const vehicle = await createResource({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Fiat", model: "Doblo", licensePlate: `34 F11 R ${suffix}` })
    const driver = await createResource({ type: "DRIVER", companyId: "bplas", facilityId: "bplas-merkez", fullName: `F11 Yarış Şoför ${suffix}`, licenseClasses: ["B"], documents: [], canDriveCommercialVehicles: false })

    const results = await Promise.allSettled([
      transportAssignments.create(transportInput(vehicle.id, driver.id, 25)),
      resourceRepository.setActive(driver.id, false),
    ])
    const created = results.find((result) => result.status === "fulfilled" && "status" in result.value)
    if (created?.status === "fulfilled") transportIds.push(created.value.id)
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const loser = results.find((result) => result.status === "rejected")
    if (loser?.status === "rejected") expect(loser.reason).toMatchObject({ statusCode: 409 })

    const [persistedDriver, assignmentCount] = await Promise.all([
      prisma.resource.findUniqueOrThrow({ where: { id: driver.id } }),
      prisma.transportAssignment.count({ where: { status: "ACTIVE", driverResourceId: driver.id } }),
    ])
    expect(assignmentCount === 0 || persistedDriver.active).toBe(true)
    expect(assignmentCount === 1 && !persistedDriver.active).toBe(false)
  })
})
