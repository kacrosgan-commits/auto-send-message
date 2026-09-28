-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT NOT NULL,
    "githubUrl" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "company" TEXT,
    "location" TEXT,
    "searchKeyword" TEXT,
    "source" TEXT NOT NULL DEFAULT 'github',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastContactedAt" DATETIME,
    "contactAttempts" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Outreach" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "templateId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFTED',
    "gmailDraftId" TEXT,
    "gmailMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "sentAt" DATETIME,
    "failureReason" TEXT,
    CONSTRAINT "Outreach_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Outreach_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountEmail" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "scope" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_email_key" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_username_idx" ON "Contact"("username");

-- CreateIndex
CREATE INDEX "Contact_status_idx" ON "Contact"("status");

-- CreateIndex
CREATE INDEX "Contact_searchKeyword_idx" ON "Contact"("searchKeyword");

-- CreateIndex
CREATE INDEX "Contact_createdAt_idx" ON "Contact"("createdAt");

-- CreateIndex
CREATE INDEX "Outreach_contactId_idx" ON "Outreach"("contactId");

-- CreateIndex
CREATE INDEX "Outreach_status_idx" ON "Outreach"("status");

-- CreateIndex
CREATE INDEX "Outreach_sentAt_idx" ON "Outreach"("sentAt");
