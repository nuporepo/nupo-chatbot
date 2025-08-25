-- CreateTable
CREATE TABLE "conversation_analytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "productsViewed" TEXT,
    "productsRecommended" TEXT,
    "topicsDiscussed" TEXT,
    "customerSatisfaction" TEXT,
    "conversionValue" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_analytics_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversation_analytics_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("sessionId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "popular_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "successRate" REAL NOT NULL DEFAULT 0.0,
    "avgResponseTime" REAL NOT NULL DEFAULT 0.0,
    "lastAsked" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "popular_questions_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_analytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "timesRecommended" INTEGER NOT NULL DEFAULT 0,
    "timesViewed" INTEGER NOT NULL DEFAULT 0,
    "timesPurchased" INTEGER NOT NULL DEFAULT 0,
    "conversionRate" REAL NOT NULL DEFAULT 0.0,
    "avgOrderValue" REAL NOT NULL DEFAULT 0.0,
    "lastRecommended" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "product_analytics_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_analytics_sessionId_key" ON "conversation_analytics"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "popular_questions_shopId_question_key" ON "popular_questions"("shopId", "question");

-- CreateIndex
CREATE UNIQUE INDEX "product_analytics_shopId_productId_key" ON "product_analytics"("shopId", "productId");
