-- Idempotency records replace the unused Lead.idempotencyKey column: they keep the
-- request hash and the stored response so a retry can be replayed exactly.
DROP INDEX "Lead_idempotencyKey_key";
ALTER TABLE "Lead" DROP COLUMN "idempotencyKey";

CREATE TABLE "IdempotencyRecord" (
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseStatus" INTEGER NOT NULL,
  "responseBody" JSONB NOT NULL,
  "leadId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "IdempotencyRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeadAuditLog" (
  "id" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "fromStatus" "LeadStatus" NOT NULL,
  "toStatus" "LeadStatus" NOT NULL,
  "actor" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadAuditLog_status_change_check" CHECK ("fromStatus" <> "toStatus"),
  CONSTRAINT "LeadAuditLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LeadAuditLog_leadId_at_idx" ON "LeadAuditLog"("leadId", "at");
