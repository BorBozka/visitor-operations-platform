-- Catalog/master-data records (Resource, VisitorCard) become permanently deletable while the
-- operational history that used them survives. Every affected child row already carries its own
-- display snapshot, so only the live catalog FK is nulled; no history row is deleted here.
--
-- Nothing in this migration touches row data other than turning three NOT NULL FK columns into
-- NULL-able ones, which preserves every existing value.

BEGIN TRY

BEGIN TRAN;

-- ---------------------------------------------------------------------------
-- ResourceAssignment.resourceId -> nullable historical reference, ON DELETE SET NULL.
-- The snapshot columns (resourceType, resourceName, companyId, facilityId, totalQuantity,
-- requestedQuantity) are untouched and stay the authoritative history.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[ResourceAssignment] DROP CONSTRAINT [ResourceAssignment_resourceId_fkey];

-- A plain SQL Server UNIQUE constraint treats NULLs as equal, so it would allow only ONE
-- assignment per Meeting to keep a deleted resource. Replaced below by a filtered unique index.
ALTER TABLE [dbo].[ResourceAssignment] DROP CONSTRAINT [ResourceAssignment_meetingId_resourceId_key];

-- ALTER COLUMN cannot run while an index depends on the column; the index is recreated verbatim.
DROP INDEX [ResourceAssignment_resourceId_idx] ON [dbo].[ResourceAssignment];

ALTER TABLE [dbo].[ResourceAssignment] ALTER COLUMN [resourceId] VARCHAR(36) NULL;

CREATE NONCLUSTERED INDEX [ResourceAssignment_resourceId_idx]
  ON [dbo].[ResourceAssignment]([resourceId]);

-- Same Meeting + same LIVE Resource stays impossible; any number of assignments whose catalog
-- Resource was deleted may sit on one Meeting with resourceId = NULL. Prisma cannot model a
-- filtered index, so this index exists only here (see the ResourceAssignment schema comment).
CREATE UNIQUE NONCLUSTERED INDEX [ResourceAssignment_meetingId_resourceId_key]
  ON [dbo].[ResourceAssignment]([meetingId], [resourceId])
  WHERE [resourceId] IS NOT NULL;

ALTER TABLE [dbo].[ResourceAssignment] ADD CONSTRAINT [ResourceAssignment_resourceId_fkey]
  FOREIGN KEY ([resourceId]) REFERENCES [dbo].[Resource]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- TransportAssignment vehicle/driver -> nullable historical references.
-- vehicleName, vehicleLicensePlate and driverName stay NOT NULL and unchanged.
--
-- Both FKs keep ON DELETE NO ACTION: SQL Server refuses a second ON DELETE SET NULL path from one
-- table to the same parent (error 1785, "may cause cycles or multiple cascade paths"), and this
-- table references Resource twice. PrismaResourceRepository.delete() nulls both columns inside
-- the same transaction as the Resource delete instead, so the effective contract is identical.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[TransportAssignment] DROP CONSTRAINT [TransportAssignment_vehicleResourceId_fkey];
ALTER TABLE [dbo].[TransportAssignment] DROP CONSTRAINT [TransportAssignment_driverResourceId_fkey];

DROP INDEX [TransportAssignment_vehicleResourceId_plannedStart_idx] ON [dbo].[TransportAssignment];
DROP INDEX [TransportAssignment_driverResourceId_plannedStart_idx] ON [dbo].[TransportAssignment];

ALTER TABLE [dbo].[TransportAssignment] ALTER COLUMN [vehicleResourceId] VARCHAR(36) NULL;
ALTER TABLE [dbo].[TransportAssignment] ALTER COLUMN [driverResourceId] VARCHAR(36) NULL;

CREATE NONCLUSTERED INDEX [TransportAssignment_vehicleResourceId_plannedStart_idx]
  ON [dbo].[TransportAssignment]([vehicleResourceId], [plannedStart]);
CREATE NONCLUSTERED INDEX [TransportAssignment_driverResourceId_plannedStart_idx]
  ON [dbo].[TransportAssignment]([driverResourceId], [plannedStart]);

ALTER TABLE [dbo].[TransportAssignment] ADD CONSTRAINT [TransportAssignment_vehicleResourceId_fkey]
  FOREIGN KEY ([vehicleResourceId]) REFERENCES [dbo].[Resource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[TransportAssignment] ADD CONSTRAINT [TransportAssignment_driverResourceId_fkey]
  FOREIGN KEY ([driverResourceId]) REFERENCES [dbo].[Resource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Visit.visitorCardId -> ON DELETE SET NULL. The column is already nullable; Visit
-- .visitorCardNumber keeps the historical card number for display after the card is deleted.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[Visit] DROP CONSTRAINT [Visit_visitorCardId_fkey];

ALTER TABLE [dbo].[Visit] ADD CONSTRAINT [Visit_visitorCardId_fkey]
  FOREIGN KEY ([visitorCardId]) REFERENCES [dbo].[VisitorCard]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
