CREATE TYPE "RepaymentType" AS ENUM ('BULLET', 'EMI');
CREATE TYPE "LeadStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "LoanScheme"
  RENAME COLUMN "annualInterestRate" TO "annualInterestBps";
ALTER TABLE "LoanScheme"
  ALTER COLUMN "annualInterestBps" TYPE INTEGER
  USING ROUND("annualInterestBps" * 100)::INTEGER;
ALTER TABLE "LoanScheme"
  RENAME COLUMN "maxLtv" TO "maxLtvBps";
ALTER TABLE "LoanScheme"
  ALTER COLUMN "maxLtvBps" TYPE INTEGER
  USING ROUND("maxLtvBps" * 10000)::INTEGER;
ALTER TABLE "LoanScheme"
  ALTER COLUMN "repaymentType" TYPE "RepaymentType"
  USING "repaymentType"::"RepaymentType";
ALTER TABLE "LoanScheme"
  RENAME COLUMN "active" TO "isActive";
ALTER TABLE "LoanScheme"
  ADD CONSTRAINT "LoanScheme_maxLtvBps_check" CHECK ("maxLtvBps" <= 7500);

CREATE SEQUENCE "lead_application_seq" START WITH 1001 INCREMENT BY 1 NO CYCLE;

CREATE TABLE "Lead" (
  "id" UUID NOT NULL,
  "applicationId" TEXT NOT NULL DEFAULT ('GL-' || nextval('lead_application_seq')::TEXT),
  "name" TEXT NOT NULL,
  "mobileNumber" TEXT NOT NULL,
  "grossWeightMg" INTEGER NOT NULL,
  "netWeightMg" INTEGER NOT NULL,
  "karat" INTEGER NOT NULL,
  "schemeId" TEXT NOT NULL,
  "goldRatePaisePerGram" BIGINT NOT NULL,
  "pureGoldMg" INTEGER NOT NULL,
  "goldValuePaise" BIGINT NOT NULL,
  "eligibleLoanPaise" BIGINT NOT NULL,
  "ltvAppliedBps" INTEGER NOT NULL,
  "status" "LeadStatus" NOT NULL DEFAULT 'SUBMITTED',
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Lead_netWeightMg_check" CHECK ("netWeightMg" > 0),
  CONSTRAINT "Lead_net_le_gross_check" CHECK ("netWeightMg" <= "grossWeightMg"),
  CONSTRAINT "Lead_grossWeightMg_check" CHECK ("grossWeightMg" <= 1000000),
  CONSTRAINT "Lead_karat_check" CHECK ("karat" IN (18, 22, 24)),
  CONSTRAINT "Lead_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "LoanScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Lead_applicationId_key" ON "Lead"("applicationId");
CREATE UNIQUE INDEX "Lead_idempotencyKey_key" ON "Lead"("idempotencyKey");
CREATE INDEX "Lead_mobileNumber_createdAt_idx" ON "Lead"("mobileNumber", "createdAt" DESC);
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt" DESC);
