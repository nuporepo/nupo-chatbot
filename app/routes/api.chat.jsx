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
    if (text) {
      where.OR = [
        { title: { contains: text, mode: 'insensitive' } },
        { searchableContent: { contains: text.toLowerCase() } },
        { keywords: { contains: text, mode: 'insensitive' } },
        { tags: { contains: text, mode: 'insensitive' } },
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

    // Create conversation history for OpenAI (trim history to reduce tokens)
    const recentMessages = (chatSession.messages || []).slice(-8).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const conversationHistory = [
      {
        role: 'system',
        content: `${shop.botConfig.systemPrompt}
 
 Store Information:
 - Store: ${storeData.shop.name}
 - Domain: ${shopDomain}
 - Currency: ${storeData.shop.currencyCode}
 - Products available: ${storeData.productCount}
 - Collections: ${storeData.collections.map(c => c.title).join(', ')}
 - When you need store facts or policy details, use tools to fetch them (do not guess)
 
 IMPORTANT RESPONSE GUIDELINES:
 - You are an intelligent shopping assistant who understands customer intent and context
 - When customers ask for products, think about what they really mean (e.g., "diet chocolate" could mean chocolate diet products, low-calorie chocolate, or chocolate-flavored diet items)
 - Give brief, helpful responses that show you understand their needs
 - Use natural, conversational language appropriate for the customer
 - AFTER showing products: Let the product cards display all details - don't repeat information
 - If you show multiple options, briefly explain why they're relevant to the customer's request
 - Be honest if you can't find exactly what they want, but offer smart alternatives
 - Think like a knowledgeable shop assistant who really understands the products and customer needs
 - Ask one short clarifying question if intent is ambiguous (never list everything blindly)
 - Offer smart choices (e.g., single item vs bundle) only after checking interest
 
 STRICT STORE-ONLY POLICY:
 - You MUST answer ONLY using information from this specific store (its products, collections, pages, and articles). Do not invent facts or use outside knowledge.
 - If the user asks anything unrelated to this store or you lack content, reply briefly: "I can help with information and products from this store only."
 - Prefer using the provided tools to search products and store content before answering.
 
 Current conversation context: Customer is asking about products or shopping assistance.`,
      },
      ...recentMessages,
      {
        role: 'user',
        content: message,
      },
    ];

    console.log("🤖 Calling OpenAI...");
    
    // LOG THE COMPLETE PROMPT FOR DEBUGGING
    console.log("📋 COMPLETE PROMPT TO OPENAI:");
    console.log("=====================================");
    conversationHistory.forEach((msg, index) => {
      console.log(`[${index}] ROLE: ${msg.role}`);
      console.log(`[${index}] CONTENT: ${msg.content}`);
      console.log("-------------------------------------");
    });
    console.log("=====================================");
    
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

    // Call OpenAI with function calling support
    const completion = await createChatCompletionWithRetry({
      model: "gpt-4o-mini",
      messages: conversationHistory,
      temperature: shop.botConfig.temperature,
      max_tokens: shop.botConfig.maxTokens,
      tools: [
        // Removed raw search_products tool for public route to avoid "search engine" behavior
        {
          type: "function",
          function: {
            name: "search_store_content",
            description: "Search the store's own content (products, articles, pages, collections) that has been scraped into the knowledge base. Use this for policy, FAQ, articles, or when validating store-specific info."
            ,parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Text to search for within store content (title, keywords, searchableContent)."
                },
                contentTypes: {
                  type: "array",
                  items: { type: "string", enum: ["product", "article", "collection", "page"] },
                  description: "Optional filter for content types"
                },
                limit: {
                  type: "number",
                  description: "Max number of items to return (default 5)"
                }
              },
              required: []
            }
          }
        }
      ],
      tool_choice: "auto",
    });

    console.log("🆔 OpenAI completion id:", completion.id);
    let assistantMessage = completion.choices[0].message;
    let functionResults = null;

    console.log("🤖 AI Response:", assistantMessage.content ?? "(tool-call only)");
    console.log("🔧 Tool calls:", assistantMessage.tool_calls?.length || 0);

    // Handle function calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolCall = assistantMessage.tool_calls[0];
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      console.log("🛠️ Function call:", toolCall.function.name, functionArgs);

      switch (toolCall.function.name) {
        case "search_store_content":
          functionResults = await searchStoreContent(shop.id, functionArgs);
          break;
      }

      // Generate a follow-up response with the function results
      console.log("🔄 Making follow-up OpenAI call with function results...");
      console.log("📊 Function results:", JSON.stringify(functionResults, null, 2));
      
      try {
        const followUpCompletion = await createChatCompletionWithRetry({
          model: "gpt-4o-mini",
          messages: [
            ...conversationHistory,
            assistantMessage,
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(functionResults),
            },
          ],
          temperature: shop.botConfig.temperature,
          max_tokens: shop.botConfig.maxTokens,
        });
        console.log("🆔 OpenAI follow-up id:", followUpCompletion.id);
        assistantMessage = followUpCompletion.choices[0].message;
        console.log("✅ Follow-up AI Response:", assistantMessage.content);
      } catch (error) {
        console.error("❌ Follow-up OpenAI call failed:", error);
        // Fallback response
        assistantMessage = {
          role: 'assistant',
          content: 'I found some great options for you!'
        };
      }
    }

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