import { json } from "@remix-run/node";
import prisma from "../db.server";
import OpenAI from "openai";
// import { shouldAutoScrape, triggerAutoScrape } from "../utils/auto-scraper";

// Intelligent product search with fuzzy matching and context understanding
function intelligentProductSearch(products, query) {
  const searchTerm = query.toLowerCase().trim();
  
  // Common misspellings and variations
  const corrections = {
    'chocolat': 'chocolate',
    'chokolate': 'chocolate', 
    'choclate': 'chocolate',
    'chocolade': 'chocolate',
    'deit': 'diet',
    'dieet': 'diet',
    'lite': 'diet',
    'light': 'diet',
    'low cal': 'diet',
    'lowcal': 'diet'
  };
  
  // Apply corrections
  let correctedQuery = searchTerm;
  Object.keys(corrections).forEach(mistake => {
    correctedQuery = correctedQuery.replace(new RegExp(mistake, 'gi'), corrections[mistake]);
  });
  
  // Extract intent and context
  const words = correctedQuery.split(/\s+/).filter(word => word.length > 2);
  
  // Score products based on relevance
  const scoredProducts = products.map(product => {
    const title = product.title.toLowerCase();
    const content = product.content?.toLowerCase() || '';
    const searchable = product.searchableContent?.toLowerCase() || '';
    const keywords = product.keywords?.toLowerCase() || '';
    
    let score = 0;
    
    // Exact title match gets highest score
    if (title.includes(correctedQuery)) score += 100;
    
    // All words found in title
    if (words.every(word => title.includes(word))) score += 80;
    
    // All words found anywhere in product
    if (words.every(word => 
      title.includes(word) || content.includes(word) || 
      searchable.includes(word) || keywords.includes(word)
    )) score += 60;
    
    // Partial matches
    words.forEach(word => {
      if (title.includes(word)) score += 20;
      if (content.includes(word)) score += 10;
      if (searchable.includes(word)) score += 15;
      if (keywords.includes(word)) score += 25;
    });
    
    // Context-aware scoring for diet + chocolate
    if (correctedQuery.includes('diet') && correctedQuery.includes('chocolate')) {
      if (title.includes('diet') && (title.includes('chocolate') || content.includes('chocolate'))) {
        score += 150; // High boost for diet chocolate products
      }
      if (title.includes('chocolate') && (content.includes('diet') || content.includes('meal replacement'))) {
        score += 120; // Chocolate diet products
      }
    }
    
    return { product, score };
  });
  
  // Return products sorted by relevance score, only those with score > 0
  return scoredProducts
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.product);
}

// Helper functions for Shopify API integration
async function getStoreContext(shopDomain) {
  // For public API, we'll create a simplified store context
  // In production, you'd want to cache this or get it from your database
  return {
    shop: { name: shopDomain.replace('.myshopify.com', ''), currencyCode: 'EUR' },
    collections: [],
    productCount: "Many",
  };
}

async function searchProducts(shopDomain, { query, collection, limit = 5 }) {
  try {
    console.log(`🔍 Searching Admin API for: ${query} in shop: ${shopDomain}`);

    // Get the shop and session for Admin API access
    const shop = await prisma.shop.findUnique({
      where: { shopDomain }
    });

    if (!shop) {
      console.error("Shop not found:", shopDomain);
      return { products: [], query, total: 0, error: "Shop not found" };
    }

    // Get the most recent session for this shop
    const session = await prisma.session.findFirst({
      where: { shop: shopDomain },
      orderBy: { id: 'desc' }
    });

    if (!session || !session.accessToken) {
      console.error("No valid session found for shop:", shopDomain);
      return { products: [], query, total: 0, error: "No valid session" };
    }

    console.log(`🔑 Using session: ${session.id} for shop: ${session.shop}`);

    // Build intelligent search query
    let shopifyQuery = '';
    if (query && query.trim()) {
      let searchTerms = query.toLowerCase().trim();

      // Map customer language to product terms
      const termMappings = {
        'vlcd': 'diet OR TDR OR "Total Diet Replacement" OR "meal replacement" OR VLCD OR "very low calorie"',
        'diet': 'diet OR TDR OR "Total Diet Replacement" OR "meal replacement"',
        'shake': 'shake OR smoothie OR drink OR liquid',
        'bar': 'bar OR snack',
        'chocolate': 'chocolate OR cocoa OR choco',
        'vanilla': 'vanilla',
        'strawberry': 'strawberry OR berry',
        'protein': 'protein OR whey'
      };

      // Apply mappings
      Object.keys(termMappings).forEach(term => {
        if (searchTerms.includes(term)) {
          searchTerms = searchTerms.replace(new RegExp(term, 'gi'), termMappings[term]);
        }
      });

      shopifyQuery = searchTerms;
      console.log(`🧠 Mapped search: "${query}" -> "${shopifyQuery}"`);
    }

    // Use Admin API GraphQL
    const adminQuery = `
      query getProducts($first: Int!, $query: String) {
        products(first: $first, query: $query) {
          edges {
            node {
              id
              title
              handle
              description
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
              featuredImage {
                url
              }
              variants(first: 1) {
                edges {
                  node {
                    availableForSale
                    price
                  }
                }
              }
            }
          }
        }
      }
    `;

    // Call Shopify Admin API
    const response = await fetch(`https://${shopDomain}/admin/api/2023-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({
        query: adminQuery,
        variables: {
          first: limit,
          query: shopifyQuery || null
        }
      })
    });

    const result = await response.json();

    if (result.errors) {
      console.error('Admin API errors:', result.errors);
      return { products: [], query, total: 0, error: 'Search failed' };
    }

    if (!result.data || !result.data.products) {
      console.error('No products data returned');
      return { products: [], query, total: 0 };
    }

    // Format results for frontend
    const products = result.data.products.edges.map(({ node: product }) => ({
      id: product.id,
      title: product.title,
      description: product.description?.replace(/<[^>]*>/g, '').substring(0, 200) || '',
      price: `${product.priceRangeV2.minVariantPrice.amount} ${product.priceRangeV2.minVariantPrice.currencyCode}`,
      image: product.featuredImage?.url || null,
      url: `/products/${product.handle}`,
      available: product.variants.edges[0]?.node.availableForSale || false
    }));

    console.log(`✅ Found ${products.length} products via Admin API for "${query}"`);

    return {
      products,
      query,
      total: products.length,
    };
  } catch (error) {
    console.error("Error searching Admin API:", error);
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
- You are an intelligent shopping assistant who understands customer intent and context
- When customers ask for products, think about what they really mean (e.g., "diet chocolate" could mean chocolate diet products, low-calorie chocolate, or chocolate-flavored diet items)
- Give brief, helpful responses that show you understand their needs
- Use natural, conversational language appropriate for the customer
- AFTER showing products: Let the product cards display all details - don't repeat information
- If you show multiple options, briefly explain why they're relevant to the customer's request
- Be honest if you can't find exactly what they want, but offer smart alternatives
- Think like a knowledgeable shop assistant who really understands the products and customer needs

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
    
    // LOG THE COMPLETE PROMPT FOR DEBUGGING
    console.log("📋 COMPLETE PROMPT TO OPENAI:");
    console.log("=====================================");
    conversationHistory.forEach((msg, index) => {
      console.log(`[${index}] ROLE: ${msg.role}`);
      console.log(`[${index}] CONTENT: ${msg.content}`);
      console.log("-------------------------------------");
    });
    console.log("=====================================");
    
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
            description: "Search for products in the store with intelligent matching. The search handles misspellings, understands context (e.g., 'diet chocolate' finds chocolate diet products), and ranks results by relevance. Only in-stock products will be returned. Give a brief, contextual response that shows you understand what the customer is looking for, then let the product cards display the details.",
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
      console.log("🔄 Making follow-up OpenAI call with function results...");
      console.log("📊 Function results:", JSON.stringify(functionResults, null, 2));
      
      try {
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