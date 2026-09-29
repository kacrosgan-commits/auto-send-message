-- CreateTable
CREATE TABLE "SendSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "maxSendsPerDay" INTEGER NOT NULL,
    "minSecondsBetweenSends" INTEGER NOT NULL,
    "testRecipient" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
