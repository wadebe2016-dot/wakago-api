-- Modèle économique : abonnement prépayé par agence, zéro commission billets.

-- AlterTable Agency : compte Campay de l'agence ; commissionRate défaut 0
ALTER TABLE "Agency" ADD COLUMN "campayAppUsername" TEXT;
ALTER TABLE "Agency" ADD COLUMN "campayAppPassword" TEXT;
ALTER TABLE "Agency" ALTER COLUMN "commissionRate" SET DEFAULT 0;

-- CreateEnum
CREATE TYPE "PlanPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'PENDING', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "NoticeKind" AS ENUM ('REMINDER_7D', 'REMINDER_2D', 'FORMAL_NOTICE', 'SECOND_NOTICE', 'SUSPENSION', 'REACTIVATION');

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period" "PlanPeriod" NOT NULL,
    "priceFcfa" INTEGER NOT NULL,
    "maxBuses" INTEGER,
    "maxRoutes" INTEGER,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "amountFcfa" INTEGER NOT NULL,
    "payerPhone" TEXT,
    "aggregatorRef" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionNotice" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" "NoticeKind" NOT NULL,
    "channels" TEXT[],
    "recipientPhone" TEXT,
    "recipientEmail" TEXT,
    "content" TEXT NOT NULL,
    "deadlineAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");
CREATE INDEX "Subscription_agencyId_status_idx" ON "Subscription"("agencyId", "status");
CREATE INDEX "Subscription_status_endsAt_idx" ON "Subscription"("status", "endsAt");
CREATE INDEX "Subscription_status_graceEndsAt_idx" ON "Subscription"("status", "graceEndsAt");
CREATE UNIQUE INDEX "SubscriptionPayment_aggregatorRef_key" ON "SubscriptionPayment"("aggregatorRef");
CREATE INDEX "SubscriptionPayment_subscriptionId_idx" ON "SubscriptionPayment"("subscriptionId");
CREATE INDEX "SubscriptionPayment_status_createdAt_idx" ON "SubscriptionPayment"("status", "createdAt");
CREATE UNIQUE INDEX "SubscriptionNotice_subscriptionId_kind_key" ON "SubscriptionNotice"("subscriptionId", "kind");
CREATE INDEX "SubscriptionNotice_agencyId_sentAt_idx" ON "SubscriptionNotice"("agencyId", "sentAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionNotice" ADD CONSTRAINT "SubscriptionNotice_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionNotice" ADD CONSTRAINT "SubscriptionNotice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
