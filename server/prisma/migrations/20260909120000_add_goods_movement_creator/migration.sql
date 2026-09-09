-- Existing goods movements predate creator auditing, so the relation stays nullable.
ALTER TABLE [dbo].[GoodsMovement] ADD [createdByUserId] VARCHAR(36);

CREATE INDEX [GoodsMovement_createdByUserId_plannedDate_idx]
ON [dbo].[GoodsMovement]([createdByUserId], [plannedDate]);

ALTER TABLE [dbo].[GoodsMovement]
ADD CONSTRAINT [GoodsMovement_createdByUserId_fkey]
FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
ON DELETE NO ACTION ON UPDATE NO ACTION;
