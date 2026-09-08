import "dotenv/config"

import { PrismaClient } from "@prisma/client"

import { hashPassword } from "../src/auth/password.js"
import { normalizeIdentity } from "../src/lib/names.js"
import { demoSeedUserScopes, getDemoSeedUsers, shouldSeedDemoData } from "./seed-data.js"

const prisma = new PrismaClient()

async function seed() {
  if (!shouldSeedDemoData(process.env)) {
    console.info("Demo seed skipped: it runs only when NODE_ENV=development and DEMO_SEED_ENABLED=true.")
    return
  }

  const company = await prisma.company.upsert({
    where: { id: "bplas" },
    update: { name: "BPLAS A.Ş.", nameNormalized: "bplas a.ş.", active: true },
    create: { id: "bplas", name: "BPLAS A.Ş.", nameNormalized: "bplas a.ş.", active: true },
  })
  const facility = await prisma.facility.upsert({
    where: { id: "bplas-merkez" },
    update: { companyId: company.id, name: "Merkez Tesis", nameNormalized: "merkez tesis", active: true },
    create: { id: "bplas-merkez", companyId: company.id, name: "Merkez Tesis", nameNormalized: "merkez tesis", active: true },
  })
  const department = await prisma.department.upsert({
    where: { id: "department-bplas-yonetim" },
    update: { companyId: company.id, name: "Yönetim", nameNormalized: "yönetim", active: true },
    create: { id: "department-bplas-yonetim", companyId: company.id, name: "Yönetim", nameNormalized: "yönetim", active: true },
  })
  const gate = await prisma.securityGate.upsert({
    where: { id: "gate-bplas-merkez-ana-giris" },
    update: { facilityId: facility.id, name: "Ana Giriş", nameNormalized: "ana giriş", active: true },
    create: { id: "gate-bplas-merkez-ana-giris", facilityId: facility.id, name: "Ana Giriş", nameNormalized: "ana giriş", active: true },
  })

  // Secondary company — isolated scope target for authorization / cross-scope tests.
  const otomotivCompany = await prisma.company.upsert({
    where: { id: "bplas-otomotiv" },
    update: { name: "BPLAS Otomotiv A.Ş.", nameNormalized: "bplas otomotiv a.ş.", active: true },
    create: { id: "bplas-otomotiv", name: "BPLAS Otomotiv A.Ş.", nameNormalized: "bplas otomotiv a.ş.", active: true },
  })
  const otomotivFacility = await prisma.facility.upsert({
    where: { id: "bplas-otomotiv-merkez" },
    update: { companyId: otomotivCompany.id, name: "Otomotiv Tesisi", nameNormalized: "otomotiv tesisi", active: true },
    create: { id: "bplas-otomotiv-merkez", companyId: otomotivCompany.id, name: "Otomotiv Tesisi", nameNormalized: "otomotiv tesisi", active: true },
  })
  const otomotivDepartment = await prisma.department.upsert({
    where: { id: "department-bplas-otomotiv-yonetim" },
    update: { companyId: otomotivCompany.id, name: "Yönetim", nameNormalized: "yönetim", active: true },
    create: { id: "department-bplas-otomotiv-yonetim", companyId: otomotivCompany.id, name: "Yönetim", nameNormalized: "yönetim", active: true },
  })
  await prisma.securityGate.upsert({
    where: { id: "gate-bplas-otomotiv-merkez-ana-giris" },
    update: { facilityId: otomotivFacility.id, name: "Ana Giriş", nameNormalized: "ana giriş", active: true },
    create: { id: "gate-bplas-otomotiv-merkez-ana-giris", facilityId: otomotivFacility.id, name: "Ana Giriş", nameNormalized: "ana giriş", active: true },
  })
  const orgById = {
    bplas: { companyId: company.id, facilityId: facility.id, departmentId: department.id, gateId: gate.id },
    "bplas-otomotiv": { companyId: otomotivCompany.id, facilityId: otomotivFacility.id, departmentId: otomotivDepartment.id, gateId: "gate-bplas-otomotiv-merkez-ana-giris" },
  } as const

  const visitTypes = [
    { id: "meeting", name: "Toplantı", nameNormalized: "toplantı" },
    { id: "job-interview", name: "İş Görüşmesi", nameNormalized: "iş görüşmesi" },
    { id: "training", name: "Eğitim", nameNormalized: "eğitim" },
    { id: "customer-visit", name: "Müşteri Ziyareti", nameNormalized: "müşteri ziyareti" },
    { id: "supplier", name: "Tedarikçi", nameNormalized: "tedarikçi" },
    { id: "technical-service", name: "Teknik Servis / Bakım", nameNormalized: "teknik servis / bakım" },
    { id: "audit", name: "Denetim", nameNormalized: "denetim" },
  ] as const
  for (const visitType of visitTypes) {
    await prisma.visitType.upsert({
      where: { id: visitType.id },
      update: { name: visitType.name, nameNormalized: visitType.nameNormalized, active: true },
      create: { ...visitType, active: true },
    })
  }
  await prisma.operationalSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", overdueToleranceMinutes: 15, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" },
  })
  await prisma.visitorRuleVersion.upsert({
    where: { version: 1 },
    update: { content: "Ziyaretçiler tesis güvenlik kurallarına ve yönlendirmelerine uymayı kabul eder.", active: true },
    create: { version: 1, content: "Ziyaretçiler tesis güvenlik kurallarına ve yönlendirmelerine uymayı kabul eder.", publishedAt: new Date(), active: true },
  })
  for (const cardNumber of ["001", "002", "003"]) {
    await prisma.visitorCard.upsert({
      where: { cardNumberNormalized: cardNumber.toLowerCase() },
      update: { cardNumber, status: "AVAILABLE", currentVisitId: null, assignedVisitorName: null },
      create: { cardNumber, cardNumberNormalized: cardNumber.toLowerCase(), status: "AVAILABLE" },
    })
  }

  for (const definition of getDemoSeedUsers(process.env)) {
    const scopeKey = demoSeedUserScopes[definition.id]?.companyId === "bplas-otomotiv" ? "bplas-otomotiv" : "bplas"
    const org = orgById[scopeKey]
    const passwordHash = await hashPassword(definition.password)
    await prisma.user.upsert({
      where: { id: definition.id },
      update: {
        username: definition.username,
        usernameNormalized: normalizeIdentity(definition.username),
        fullName: definition.fullName,
        email: definition.email,
        emailNormalized: normalizeIdentity(definition.email),
        role: definition.role,
        authenticationSource: "LOCAL",
        active: true,
        passwordHash,
      },
      create: {
        id: definition.id,
        username: definition.username,
        usernameNormalized: normalizeIdentity(definition.username),
        fullName: definition.fullName,
        email: definition.email,
        emailNormalized: normalizeIdentity(definition.email),
        role: definition.role,
        authenticationSource: "LOCAL",
        active: true,
        passwordHash,
      },
    })

    await prisma.userCompanyScope.upsert({
      where: { userId_companyId: { userId: definition.id, companyId: org.companyId } },
      update: {},
      create: { userId: definition.id, companyId: org.companyId },
    })
    await prisma.userFacilityScope.upsert({
      where: { userId_facilityId: { userId: definition.id, facilityId: org.facilityId } },
      update: {},
      create: { userId: definition.id, facilityId: org.facilityId },
    })
    await prisma.userSecurityGateScope.upsert({
      where: { userId_securityGateId: { userId: definition.id, securityGateId: org.gateId } },
      update: {},
      create: { userId: definition.id, securityGateId: org.gateId },
    })

    if (definition.employeeId) {
      await prisma.employee.upsert({
        where: { id: definition.employeeId },
        update: { userId: definition.id, fullName: definition.fullName, companyId: org.companyId, departmentId: org.departmentId, active: true },
        create: { id: definition.employeeId, userId: definition.id, fullName: definition.fullName, companyId: org.companyId, departmentId: org.departmentId, active: true },
      })
      await prisma.employeeFacilityScope.upsert({
        where: { employeeId_facilityId: { employeeId: definition.employeeId, facilityId: org.facilityId } },
        update: {},
        create: { employeeId: definition.employeeId, facilityId: org.facilityId },
      })
    }
  }

  console.info("Development demo seed completed.")
}

try {
  await seed()
} finally {
  await prisma.$disconnect()
}
