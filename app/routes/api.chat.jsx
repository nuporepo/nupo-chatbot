import { json } from "@remix-run/node";
import OpenAI from "openai";
// import { shouldAutoScrape, triggerAutoScrape } from "../utils/auto-scraper";

// Helper functions
async function getStoreContext(shopDomain) {
  // For public API, we'll create a simplified store context
  // In production, you'd want to cache this or get it from your database
  return {
    shop: { name: shopDomain.replace('.myshopify.com', ''), currencyCode: 'EUR' },
    collections: [],
    productCount: "Many",
  };
}

// Search pre-scraped store content (products, articles, collections, pages)
async function searchStoreContent(shopId, { query, contentTypes = [], limit = 5 }) {
  try {
    const prisma = (await import("../db.server")).default;
    const where = {
      shopId,
      isActive: true,
    };
    if (contentTypes && contentTypes.length > 0) {
      where.contentType = { in: contentTypes };
    }
    const text = (query || '').trim();
    const textLower = text.toLowerCase();
    if (text) {
      where.OR = [
        { searchableContent: { contains: textLower } },
        { keywords: { contains: textLower } },
        { tags: { contains: textLower } },
        { title: { contains: textLower } },
      ];
    }

    const items = await prisma.shopContent.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        contentType: true,
        title: true,
        excerpt: true,
        url: true,
        publishedAt: true,
      }
    });

    const total = await prisma.shopContent.count({ where });

    return {
      items,
      query: text,
      total,
      contentTypes: contentTypes.length ? contentTypes : undefined,
    };
  } catch (error) {
    console.error('Error searching store content:', error);
    return { items: [], query, total: 0, error: 'Failed to search content' };
  }
}

export const action = async ({ request }) => {
  console.log("🚀 Public Chat API called!");
  try {
    const formData = await request.formData();
    const message = formData.get("message");
    const sessionId = formData.get("sessionId");
    const customerFingerprint = formData.get("fingerprint");
    
    // Extract shop domain from referrer or request
    const shopDomain = new URL(request.url).searchParams.get("shop") || 
                      request.headers.get("referer")?.match(/shop=([^&]+)/)?.[1];
    
    if (!shopDomain) {
      return json({ error: "Shop domain not found" }, { status: 400 });
    }

    console.log("📝 Message:", message);
    console.log("🏪 Shop:", shopDomain);

    // Get shop configuration
    const prisma = (await import("../db.server")).default;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      include: {
        botConfig: true,
        knowledgeBase: true,
      },
    });

    if (!shop || !shop.botConfig) {
      return json({ 
        error: "Chatbot not configured for this store" 
      }, { status: 404 });
    }

    // Check if OpenAI API key is configured
    const apiKey = shop.botConfig.openaiApiKey || process.env.OPENAI_API_KEY;
    console.log("🔐 OpenAI key source:", shop.botConfig.openaiApiKey ? "shop-configured" : process.env.OPENAI_API_KEY ? "env" : "missing");
    if (!apiKey) {
      return json({ 
        error: shop.botConfig.errorMessage || "Service temporarily unavailable" 
      });
    }

    // Create OpenAI client
    const openai = new OpenAI({ apiKey });

    // Get or create chat session
    const prisma2 = (await import("../db.server")).default;
    let chatSession = await prisma2.chatSession.findUnique({
      where: { sessionId },
      include: { messages: { orderBy: { timestamp: 'asc' } } },
    });

    if (!chatSession) {
      chatSession = await prisma2.chatSession.create({
        data: {
          sessionId,
          shopId: shop.id,
          currentCart: "{}",
          language: "en",
          isActive: true,
          customerFingerprint,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
        include: { messages: true },
      });
    }

    // Save user message
    await prisma2.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: 'user',
        content: message,
      },
    });

    // Get store context
    const storeData = await getStoreContext(shopDomain);

    // Helper: retry OpenAI calls on 429s with short capped wait
    async function createChatCompletionWithRetry(params, maxRetries = 2) {
      let attempt = 0;
      while (true) {
        try {
          return await openai.chat.completions.create(params);
        } catch (error) {
          const status = error?.status;
          if (status === 429 && attempt < maxRetries) {
            const retryAfterMs = Number(error?.headers?.["retry-after-ms"]) ||
              (Number(error?.headers?.["retry-after"]) * 1000) ||
              (1000 * (attempt + 1));
            const waitMs = Math.min(retryAfterMs || 1000, 5000);
            console.warn(`⚠️ OpenAI rate limited. Retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, waitMs));
            attempt += 1;
            continue;
          }
          throw error;
        }
      }
    }

    // TOOL-FIRST: search store content using the user's message
    const functionResults = await searchStoreContent(shop.id, { query: message, contentTypes: ['product'], limit: 6 });

    // Build a tiny context for one short, intelligent reply (no tools)
    const titles = (functionResults.items || []).map((p, i) => `${i + 1}. ${p.title}`).join('\n');
    const conversationHistory = [
      {
        role: 'system',
        content: `You are a concise, store-only shopping assistant for ${storeData.shop.name}. Respond with ONE short sentence. If intent is unclear, ask ONE brief clarifying question. Do not repeat product details; cards will show them.`
      },
      { role: 'user', content: message },
      { role: 'system', content: `Candidate products (titles only):\n${titles || 'None found'}` }
    ];

    console.log("🤖 Calling OpenAI (single completion)...");
    const completion = await createChatCompletionWithRetry({
      model: "gpt-4o-mini",
      messages: conversationHistory,
      temperature: Math.min(shop.botConfig.temperature, 0.7),
      max_tokens: Math.min(shop.botConfig.maxTokens, 120),
    });
    console.log("🆔 OpenAI completion id:", completion.id);
    let assistantMessage = completion.choices[0].message;

    // Save assistant message
    await prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: 'assistant',
        content: assistantMessage.content ?? '',
        metadata: JSON.stringify(functionResults),
      },
    });

    // Track analytics if enabled
    if (shop.botConfig.enableConversationAnalytics) {
      // Simple analytics tracking for public chatbot
      const prisma3 = (await import("../db.server")).default;
      await prisma3.popularQuestions.upsert({
        where: { 
          shopId_question: { shopId: shop.id, question: message.toLowerCase().trim() }
        },
        update: {
          frequency: { increment: 1 },
          lastAsked: new Date(),
        },
        create: {
          shopId: shop.id,
          question: message.toLowerCase().trim(),
          frequency: 1,
          lastAsked: new Date(),
        }
      }).catch(() => {}); // Ignore errors for analytics
    }

    return json({
      message: assistantMessage.content ?? '',
      sessionId: sessionId,
      metadata: functionResults,
    });

  } catch (error) {
    console.error("❌ Public Chat API error:", error);
    return json({ 
      error: "I apologize, but I'm having trouble right now. Please try again in a moment." 
    }, { status: 500 });
  }
};