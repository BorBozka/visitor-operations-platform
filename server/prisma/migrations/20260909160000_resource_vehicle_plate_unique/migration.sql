CREATE UNIQUE NONCLUSTERED INDEX [Resource_companyId_licensePlate_key]
ON [dbo].[Resource]([companyId], [licensePlate])
WHERE [licensePlate] IS NOT NULL;
