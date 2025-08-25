import { json } from "@remix-run/node";
import prisma from "../db.server";
import OpenAI from "openai";

// Helper functions for Shopify API integration
async function getStoreContext(shopDomain) {
  // For public API, we'll create a simplified store context
  // In production, you'd want to cache this or get it from your database
  return {
    shop: { name: shopDomain.replace('.myshopify.com', ''), currencyCode: 'USD' },
    collections: [],
    productCount: "Many",
  };
}

async function searchProducts(shopDomain, { query, collection, limit = 5 }) {
  try {
    // For the public API, we need to use Shopify's Storefront API or Admin API
    // This is a simplified version - in production you'd use proper Shopify API calls
    console.log(`🔍 Searching products for: ${query} in shop: ${shopDomain}`);
    
    // Return mock data for now - you'll need to implement actual Shopify Storefront API calls
    return {
      products: [],
      query,
      total: 0,
      message: "Product search is being implemented for the public chatbot. Please use the admin version for full product integration."
    };
  } catch (error) {
    console.error("Error searching products:", error);
    return {
      products: [],
      query,
      total: 0,
      error: "Failed to search products",
    };
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
    if (!apiKey) {
      return json({ 
        error: shop.botConfig.errorMessage || "Service temporarily unavailable" 
      });
    }

    // Create OpenAI client
    const openai = new OpenAI({ apiKey });

    // Get or create chat session
    let chatSession = await prisma.chatSession.findUnique({
      where: { sessionId },
      include: { messages: { orderBy: { timestamp: 'asc' } } },
    });

    if (!chatSession) {
      chatSession = await prisma.chatSession.create({
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
    await prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: 'user',
        content: message,
      },
    });

    // Get store context
    const storeData = await getStoreContext(shopDomain);

    // Create conversation history for OpenAI
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

Knowledge Base:
${shop.knowledgeBase.map(kb => `${kb.title}: ${kb.content}`).join('\n')}

IMPORTANT RESPONSE GUIDELINES:
- You are the expert for this store - never say "it looks like" or "seems like" - you KNOW the products
- When showing products, present them professionally with clear structure
- Always include product images when available
- After showing products, ask a follow-up question to help narrow down their needs
- Use confident, knowledgeable language - you're the expert here
- Format product information clearly with proper spacing and structure
- Always end with a specific question to guide the conversation forward

Current conversation context: Customer is asking about products or shopping assistance.`,
      },
      ...chatSession.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      {
        role: 'user',
        content: message,
      },
    ];

    console.log("🤖 Calling OpenAI...");
    
    // Call OpenAI with function calling support
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversationHistory,
      temperature: shop.botConfig.temperature,
      max_tokens: shop.botConfig.maxTokens,
      tools: [
        {
          type: "function",
          function: {
            name: "search_products",
            description: "Search for products in the store. Use this when customers ask about products. After getting results, present them professionally with clear structure, include images, and ask a specific follow-up question to help narrow their needs.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query for products. Use specific terms when customer asks for something specific, or leave empty to get all products when they ask 'what do you sell'"
                },
                collection: {
                  type: "string",
                  description: "Optional collection to search within"
                },
                limit: {
                  type: "number",
                  description: "Number of products to return (default: 5, max: 8 for better readability)"
                }
              },
              required: []
            }
          }
        }
      ],
      tool_choice: "auto",
    });

    let assistantMessage = completion.choices[0].message;
    let functionResults = null;

    console.log("🤖 AI Response:", assistantMessage.content);
    console.log("🔧 Tool calls:", assistantMessage.tool_calls?.length || 0);

    // Handle function calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolCall = assistantMessage.tool_calls[0];
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      console.log("🛠️ Function call:", toolCall.function.name, functionArgs);

      switch (toolCall.function.name) {
        case "search_products":
          functionResults = await searchProducts(shopDomain, functionArgs);
          break;
      }

      // Generate a follow-up response with the function results
      const followUpCompletion = await openai.chat.completions.create({
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

      assistantMessage = followUpCompletion.choices[0].message;
    }

    // Save assistant message
    await prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: 'assistant',
        content: assistantMessage.content,
        metadata: JSON.stringify(functionResults),
      },
    });

    // Track analytics if enabled
    if (shop.botConfig.enableConversationAnalytics) {
      // Simple analytics tracking for public chatbot
      await prisma.popularQuestions.upsert({
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
      message: assistantMessage.content,
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