-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerInfo" TEXT,
    "currentCart" TEXT NOT NULL DEFAULT '{}',
    "language" TEXT NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customerFingerprint" TEXT,
    "customerEmail" TEXT,
    "isReturning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "chat_sessions_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_sessions" ("createdAt", "currentCart", "customerInfo", "expiresAt", "id", "isActive", "language", "sessionId", "shopId", "updatedAt") SELECT "createdAt", "currentCart", "customerInfo", "expiresAt", "id", "isActive", "language", "sessionId", "shopId", "updatedAt" FROM "chat_sessions";
DROP TABLE "chat_sessions";
ALTER TABLE "new_chat_sessions" RENAME TO "chat_sessions";
CREATE UNIQUE INDEX "chat_sessions_sessionId_key" ON "chat_sessions"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
