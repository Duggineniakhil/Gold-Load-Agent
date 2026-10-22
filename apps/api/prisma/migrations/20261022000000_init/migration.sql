CREATE TABLE "LoanScheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "annualInterestRate" DECIMAL(5,2) NOT NULL,
    "maxLtv" DECIMAL(4,3) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "repaymentType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoanScheme_pkey" PRIMARY KEY ("id")
);
