-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bot_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "botName" TEXT NOT NULL DEFAULT 'Shop Assistant',
    "welcomeMessage" TEXT NOT NULL DEFAULT 'Hello! I''m here to help you find the perfect products. What are you looking for today?',
    "systemPrompt" TEXT NOT NULL DEFAULT 'You are a helpful shopping assistant for this store. Help customers find products, explain features, and guide them through their purchase.',
    "errorMessage" TEXT NOT NULL DEFAULT 'I apologize, but I''m having trouble right now. Please try again in a moment.',
    "typingMessage" TEXT NOT NULL DEFAULT 'Typing...',
    "placeholderText" TEXT NOT NULL DEFAULT 'Ask me anything about products...',
    "buttonText" TEXT NOT NULL DEFAULT 'Send',
    "chatTitle" TEXT NOT NULL DEFAULT 'Shop Assistant',
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bot_configs_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_bot_configs" ("botName", "createdAt", "id", "isActive", "maxTokens", "shopId", "systemPrompt", "temperature", "updatedAt", "welcomeMessage") SELECT "botName", "createdAt", "id", "isActive", "maxTokens", "shopId", "systemPrompt", "temperature", "updatedAt", "welcomeMessage" FROM "bot_configs";
DROP TABLE "bot_configs";
ALTER TABLE "new_bot_configs" RENAME TO "bot_configs";
CREATE UNIQUE INDEX "bot_configs_shopId_key" ON "bot_configs"("shopId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
