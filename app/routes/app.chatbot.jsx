import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect, useRef } from "react";
import { Page, Card, BlockStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { v4 as uuidv4 } from "uuid";
import prisma from "../db.server";
import OpenAI from "openai";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  // Get shop configuration for UI text and position
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { botConfig: true },
  });
  
  return json({
    shopDomain: session.shop,
    sessionId: uuidv4(),
    config: shop?.botConfig || {},
    position: shop?.botConfig?.position || "bottom-right", // Get the configured position
  });
};

// Helper functions
async function getCustomerOrderHistory(admin, email) {
  if (!email) return null;
  
  try {
    const response = await admin.graphql(`
      query getCustomerOrders($email: String!) {
        customers(first: 1, query: $email) {
          edges {
            node {
              id
              firstName
              lastName
              email
              orders(first: 10, sortKey: CREATED_AT, reverse: true) {
                edges {
                  node {
                    id
                    name
                    createdAt
                    totalPrice
                    lineItems(first: 20) {
                      edges {
                        node {
                          title
                          quantity
                          variant {
                            title
                            product {
                              title
                              productType
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, {
      variables: { email: `email:${email}` }
    });

    const data = await response.json();
    const customer = data.data?.customers?.edges[0]?.node;
    
    if (!customer) return null;

    const orders = customer.orders.edges.map(edge => ({
      id: edge.node.id,
      name: edge.node.name,
      createdAt: edge.node.createdAt,
      totalPrice: edge.node.totalPrice,
      items: edge.node.lineItems.edges.map(item => ({
        title: item.node.title,
        quantity: item.node.quantity,
        variant: item.node.variant?.title,
        product: item.node.variant?.product?.title,
        productType: item.node.variant?.product?.productType,
      })),
    }));

    return {
      customer: {
        name: `${customer.firstName} ${customer.lastName}`.trim(),
        email: customer.email,
      },
      orders,
      totalOrders: orders.length,
      lastOrderDate: orders[0]?.createdAt,
      favoriteProducts: getFavoriteProducts(orders),
    };
  } catch (error) {
    console.error("Error fetching customer orders:", error);
    return null;
  }
}

function getFavoriteProducts(orders) {
  const productCounts = {};
  
  orders.forEach(order => {
    order.items.forEach(item => {
      const key = item.product;
      productCounts[key] = (productCounts[key] || 0) + item.quantity;
    });
  });

  return Object.entries(productCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([product, count]) => ({ product, count }));
}

async function findReturningCustomer(admin, shopId, fingerprint) {
  if (!fingerprint) return null;

  try {
    // Look for previous sessions with same fingerprint
    const previousSessions = await prisma.chatSession.findMany({
      where: {
        shopId,
        customerFingerprint: fingerprint,
        customerEmail: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 5,
        }
      }
    });

    if (previousSessions.length === 0) return null;

    const lastSession = previousSessions[0];
    
    // Get order history for this customer
    const orderHistory = await getCustomerOrderHistory(admin, lastSession.customerEmail);
    
    return {
      email: lastSession.customerEmail,
      lastVisit: lastSession.createdAt,
      recentMessages: lastSession.messages,
      orderHistory,
    };
  } catch (error) {
    console.error("Error finding returning customer:", error);
    return null;
  }
}

async function getStoreContext(admin, shop) {
  try {
    const response = await admin.graphql(`
      query getStoreInfo {
        shop {
          name
          primaryDomain {
            host
          }
          currencyCode
          myshopifyDomain
        }
        collections(first: 10) {
          edges {
            node {
              id
              title
              handle
            }
          }
        }
        products(first: 100) {
          edges {
            node {
              id
            }
          }
        }
      }
    `);

    const data = await response.json();
    const productCount = data.data.products.edges.length;
    
    return {
      shop: data.data.shop,
      collections: data.data.collections.edges.map(edge => edge.node),
      productCount: productCount > 0 ? productCount.toString() : "0",
    };
  } catch (error) {
    console.error("Error fetching store context:", error);
    return { 
      shop: { name: "Unknown Store", currencyCode: "USD" }, 
      collections: [], 
      productCount: "0" 
    };
  }
}

async function searchProducts(admin, { query, collection, limit = 5 }) {
  try {
    // If no specific query, get all products
    let searchQuery = query && query.trim() ? `title:*${query}* OR body:*${query}* OR tag:*${query}*` : '';
    
    const response = await admin.graphql(`
      query searchProducts($query: String, $first: Int!) {
        products(first: $first, query: $query) {
          edges {
            node {
              id
              title
              handle
              description
              images(first: 1) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
              variants(first: 3) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    availableForSale
                  }
                }
              }
              collections(first: 3) {
                edges {
                  node {
                    title
                  }
                }
              }
            }
          }
        }
      }
    `, {
      variables: {
        query: searchQuery,
        first: limit,
      },
    });

    const data = await response.json();
    const products = data.data.products.edges
      .map(edge => {
        const product = edge.node;
        const mainVariant = product.variants.edges[0]?.node;
        const image = product.images.edges[0]?.node;
        
        return {
          id: product.id,
          title: product.title,
          handle: product.handle,
          description: product.description?.substring(0, 150) + (product.description?.length > 150 ? '...' : ''),
          price: mainVariant?.price || 'Price on request',
          compareAtPrice: mainVariant?.compareAtPrice,
          available: mainVariant?.availableForSale ?? false,
          image: image ? {
            url: image.url,
            alt: image.altText || product.title
          } : null,
          variants: product.variants.edges.map(v => v.node),
          collections: product.collections.edges.map(c => c.node.title),
        };
      })
      .filter(product => product.available); // Only show products that are in stock
    
    return {
      products,
      query: query || 'all products',
      total: products.length,
      message: `Found ${products.length} product${products.length !== 1 ? 's' : ''} in our catalog.`
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

// Analytics functions
async function trackConversationAnalytics(sessionId, shopId, messageCount, productsViewed, productsRecommended, topics) {
  try {
    await prisma.conversationAnalytics.upsert({
      where: { sessionId },
      update: {
        messageCount,
        productsViewed: JSON.stringify(productsViewed),
        productsRecommended: JSON.stringify(productsRecommended),
        topicsDiscussed: JSON.stringify(topics),
        duration: Math.floor((new Date() - new Date()) / 60000), // Will be calculated properly
      },
      create: {
        sessionId,
        shopId,
        outcome: 'pending',
        duration: 0,
        messageCount,
        productsViewed: JSON.stringify(productsViewed),
        productsRecommended: JSON.stringify(productsRecommended),
        topicsDiscussed: JSON.stringify(topics),
      }
    });
  } catch (error) {
    console.error("Error tracking conversation analytics:", error);
  }
}

async function trackPopularQuestion(shopId, question) {
  try {
    const normalizedQuestion = question.toLowerCase().trim();
    if (normalizedQuestion.length < 3) return; // Skip very short questions
    
    await prisma.popularQuestions.upsert({
      where: { 
        shopId_question: { shopId, question: normalizedQuestion }
      },
      update: {
        frequency: { increment: 1 },
        lastAsked: new Date(),
      },
      create: {
        shopId,
        question: normalizedQuestion,
        frequency: 1,
        lastAsked: new Date(),
      }
    });
  } catch (error) {
    console.error("Error tracking popular question:", error);
  }
}

async function trackProductAnalytics(shopId, productId, productTitle, action = 'viewed') {
  try {
    const updateData = {};
    if (action === 'viewed') updateData.timesViewed = { increment: 1 };
    if (action === 'recommended') updateData.timesRecommended = { increment: 1 };
    if (action === 'purchased') updateData.timesPurchased = { increment: 1 };
    
    await prisma.productAnalytics.upsert({
      where: { 
        shopId_productId: { shopId, productId }
      },
      update: {
        ...updateData,
        lastRecommended: action === 'recommended' ? new Date() : undefined,
      },
      create: {
        shopId,
        productId,
        productTitle,
        timesViewed: action === 'viewed' ? 1 : 0,
        timesRecommended: action === 'recommended' ? 1 : 0,
        timesPurchased: action === 'purchased' ? 1 : 0,
        lastRecommended: action === 'recommended' ? new Date() : null,
      }
    });
  } catch (error) {
    console.error("Error tracking product analytics:", error);
  }
}

export const action = async ({ request }) => {
  console.log("🚀 App Chatbot API called!");
  try {
    const { admin, session } = await authenticate.admin(request);
    console.log("✅ Authentication successful:", session.shop);
    
    const formData = await request.formData();
    const message = formData.get("message");
    const sessionId = formData.get("sessionId");
    const customerFingerprint = formData.get("fingerprint"); // Browser fingerprint
    const customerInfo = {
      language: "en",
      timestamp: new Date().toISOString(),
      fingerprint: customerFingerprint,
    };
    
    console.log("📝 Message:", message);

    // Get or create shop configuration
    let shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      include: {
        botConfig: true,
        knowledgeBase: true,
      },
    });

    if (!shop) {
      // Create shop with default config
      shop = await prisma.shop.create({
        data: {
          shopDomain: session.shop,
          botConfig: {
            create: {
              botName: "Shop Assistant",
              welcomeMessage: "Hello! I'm here to help you find the perfect products. What are you looking for today?",
              systemPrompt: `You are a helpful shopping assistant for ${session.shop}. Help customers find products, explain features, and guide them through their purchase.`,
              position: "bottom-right",
            },
          },
        },
        include: {
          botConfig: true,
          knowledgeBase: true,
        },
      });
    }

    // Check for returning customer if memory is enabled
    let returningCustomer = null;
    if (shop.botConfig.enableCustomerMemory && customerFingerprint) {
      returningCustomer = await findReturningCustomer(admin, shop.id, customerFingerprint);
      console.log("🧠 Returning customer found:", !!returningCustomer);
    }

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
          customerInfo: JSON.stringify(customerInfo),
          customerFingerprint: customerFingerprint,
          customerEmail: returningCustomer?.email,
          isReturning: !!returningCustomer,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
        include: { messages: { orderBy: { timestamp: 'asc' } } },
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
    const storeData = await getStoreContext(admin, shop);
    
    // Prepare conversation history with customer memory if available
    let customerMemoryContext = '';
    if (returningCustomer && returningCustomer.orderHistory) {
      const { customer, orders, favoriteProducts } = returningCustomer.orderHistory;
      customerMemoryContext = `

RETURNING CUSTOMER DETECTED:
- Customer: ${customer.name}
- Email: ${customer.email}
- Total Orders: ${orders.length}
- Last Order: ${orders[0]?.createdAt ? new Date(orders[0].createdAt).toDateString() : 'N/A'}
- Favorite Products: ${favoriteProducts.map(p => `${p.product} (${p.count}x)`).join(', ')}
- Recent Purchase History: ${orders.slice(0, 3).map(o => `${o.name} (${new Date(o.createdAt).toDateString()})`).join(', ')}

IMPORTANT: Welcome them back personally and reference their purchase history appropriately. Ask about their experience with previous products.`;
    }

    const conversationHistory = [
      {
        role: 'system',
        content: `${shop.botConfig.systemPrompt}

Store Information:
- Store: ${storeData.shop.name}
- Domain: ${session.shop}
- Currency: ${storeData.shop.currencyCode}
- Products available: ${storeData.productCount}
- Collections: ${storeData.collections.map(c => c.title).join(', ')}

Knowledge Base:
${shop.knowledgeBase.map(kb => `${kb.title}: ${kb.content}`).join('\n')}

${customerMemoryContext}

IMPORTANT RESPONSE GUIDELINES:
- You are a helpful shopping assistant - keep communication simple and minimal
- NEVER include URLs, technical details, or product codes in your responses
- When showing products, use MAXIMUM 1-2 sentences like "Here are some great options!" or "Found these for you!"
- Product cards show all the details automatically - DON'T repeat prices, descriptions, or features in text
- Keep responses under 20 words when possible
- Always end with a simple question like "Which one interests you?" or "Need help choosing?"
- If results don't match what they asked for, just say "Let me search differently" and try again
- Act like a concise, helpful waiter - let the visual product cards do the talking

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

    // Check if OpenAI API key is configured
    const apiKey = shop.botConfig.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json({ error: "OpenAI API key not configured. Please add your API key in the bot configuration." });
    }

    // Create OpenAI client with the configured API key
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    console.log("🤖 Calling OpenAI...");
    
    // Call OpenAI
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
            description: "Search for products in the store. Only in-stock products will be returned. After searching, give a very brief response (under 20 words) like 'Here are some great options!' then let the product cards show all the details. Keep it simple and conversational.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query for products. Use specific terms when customer asks for something specific, or leave empty to get all products when they ask 'what do you sell'. If first search doesn't match what customer wants, try alternative terms like synonyms or related words."
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
      ]
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
          functionResults = await searchProducts(admin, functionArgs);
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
      console.log("📊 Tracking analytics for session:", sessionId);
      
      // Track popular question
      await trackPopularQuestion(shop.id, message);
      
      // Extract products from function results
      const productsViewed = [];
      const productsRecommended = [];
      const topics = [message.toLowerCase()];
      
      if (functionResults && functionResults.products) {
        functionResults.products.forEach(product => {
          productsViewed.push(product.id);
          productsRecommended.push(product.id);
          
          // Track individual product analytics
          trackProductAnalytics(shop.id, product.id, product.title, 'viewed');
          trackProductAnalytics(shop.id, product.id, product.title, 'recommended');
        });
      }
      
      // Get current message count
      const messageCount = await prisma.chatMessage.count({
        where: { sessionId: chatSession.id }
      });
      
      // Track conversation analytics
      await trackConversationAnalytics(
        chatSession.sessionId, 
        shop.id, 
        messageCount, 
        productsViewed, 
        productsRecommended, 
        topics
      );
    }

    return json({
      message: assistantMessage.content,
      sessionId: sessionId,
      metadata: functionResults,
    });

  } catch (error) {
    console.error("❌ App Chatbot error:", error);
    
    // Get error message from config
    const { session } = await authenticate.admin(request);
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      include: { botConfig: true },
    });
    
    return json({ 
      message: shop?.botConfig?.errorMessage || "I apologize, but I'm having trouble right now. Please try again in a moment.",
      sessionId: request.formData().get("sessionId"),
    });
  }
};

export default function AppChatbot() {
  const { shopDomain, sessionId, config, position } = useLoaderData();
  const fetcher = useFetcher();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef(null);
  
  const isLoading = fetcher.state === "submitting";

  // Initialize with welcome message
  useEffect(() => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: config.welcomeMessage || `Hello! I'm your personal shopping assistant for ${shopDomain}. How can I help you today?`,
        timestamp: new Date(),
      },
    ]);
  }, [shopDomain, config.welcomeMessage]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.data) {
      console.log("📨 Fetcher data:", fetcher.data);
      
      if (fetcher.data.error) {
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: "assistant",
          content: config.errorMessage || "I apologize, but I'm having trouble right now. Please try again in a moment.",
          timestamp: new Date(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: "assistant",
          content: fetcher.data.message,
          metadata: fetcher.data.metadata,
          timestamp: new Date(),
        }]);
      }
    }
  }, [fetcher.data]);

  const sendMessage = () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    
    // Use Remix fetcher for proper form submission
    fetcher.submit(
      {
        message: userMessage.content,
        sessionId: sessionId,
      },
      { method: "POST" }
    );
    
    setInputValue("");
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Style the test container based on position setting
  const getContainerStyle = () => {
    const baseStyle = {
      border: "1px solid #e1e3e5", 
      borderRadius: "8px", 
      padding: "16px",
      backgroundColor: "#fafbfb"
    };

    switch(position) {
      case "hero":
        return {
          ...baseStyle,
          height: "600px", 
          overflowY: "auto", 
          maxWidth: "800px",
          margin: "0 auto"
        };
      case "bottom-right":
      case "bottom-left":
      case "top-right":
      case "top-left":
        return {
          ...baseStyle,
          height: "400px", 
          overflowY: "auto", 
          maxWidth: "350px",
          margin: position.includes("right") ? "0 0 0 auto" : position.includes("left") ? "0 auto 0 0" : "0 auto"
        };
      default: // popup or embedded
        return {
          ...baseStyle,
          height: "400px", 
          overflowY: "auto", 
          maxWidth: "400px",
          margin: "0 auto"
        };
    }
  };

  const containerStyle = getContainerStyle();

  // Get display name for position
  const getPositionDisplayName = () => {
    switch(position) {
      case "hero": return "Hero Section";
      case "bottom-right": return "Bottom Right";
      case "bottom-left": return "Bottom Left";
      case "top-right": return "Top Right";
      case "top-left": return "Top Left";
      case "popup": return "Popup";
      case "embedded": return "Embedded";
      default: return "Default";
    }
  };

  return (
    <Page title={`Test Your ${config.chatTitle || 'Chatbot'} (${getPositionDisplayName()} Mode)`}>
      <Card>
        <BlockStack gap="400">
          <div style={{ 
            padding: "12px 16px", 
            backgroundColor: "#f6f6f7", 
            borderRadius: "8px",
            fontSize: "14px",
            color: "#616161"
          }}>
            <strong>Preview Mode:</strong> {getPositionDisplayName()} - This shows how your chatbot will appear to customers. The size and layout reflect your position setting.
          </div>
          <div style={containerStyle}>
            {messages.map((message) => (
              <div
                key={message.id}
                style={{
                  marginBottom: "12px",
                  display: "flex",
                  justifyContent: message.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: "18px",
                      backgroundColor: message.role === "user" ? "#007cba" : "#f1f3f4",
                      color: message.role === "user" ? "white" : "#202223",
                      fontSize: "14px",
                      lineHeight: "1.4",
                    }}
                  >
                    {message.content}
                  </div>
                  {message.metadata && message.metadata.products && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {message.metadata.products.slice(0, 6).map((product) => (
                        <div
                          key={product.id}
                          style={{
                            backgroundColor: "#ffffff",
                            border: "1px solid #e1e3e5",
                            borderRadius: "12px",
                            padding: "12px",
                            fontSize: "13px",
                            display: "flex",
                            gap: "12px",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.transform = "scale(1.02)";
                            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.transform = "scale(1)";
                            e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
                          }}
                        >
                          {product.image && (
                            <img
                              src={product.image.url}
                              alt={product.image.alt}
                              style={{
                                width: "60px",
                                height: "60px",
                                objectFit: "cover",
                                borderRadius: "8px",
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ 
                              fontWeight: "600", 
                              marginBottom: "4px",
                              fontSize: "14px",
                              lineHeight: "1.3",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "#202223"
                            }}>
                              {product.title}
                            </div>
                            {product.description && (
                              <div style={{ 
                                color: "#6d7175", 
                                fontSize: "12px",
                                lineHeight: "1.3",
                                marginBottom: "6px",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden"
                              }}>
                                {product.description}
                              </div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ 
                                color: "#007cba", 
                                fontWeight: "700",
                                fontSize: "14px"
                              }}>
                                ${product.price}
                              </div>
                              {product.compareAtPrice && parseFloat(product.compareAtPrice) > parseFloat(product.price) && (
                                <div style={{ 
                                  color: "#6d7175", 
                                  textDecoration: "line-through",
                                  fontSize: "12px"
                                }}>
                                  ${product.compareAtPrice}
                                </div>
                              )}

                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  padding: "12px 16px",
                  borderRadius: "18px",
                  backgroundColor: "#f1f3f4",
                  fontSize: "14px",
                }}>
                  {config.typingMessage || "Typing..."}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={config.placeholderText || "Ask me anything about products..."}
              style={{
                flex: 1,
                padding: "12px 16px",
                border: "1px solid #c9cccf",
                borderRadius: "6px",
                fontSize: "14px",
              }}
              disabled={isLoading}
            />
            <button
              onClick={sendMessage}
              disabled={!inputValue.trim() || isLoading}
              style={{
                padding: "12px 24px",
                backgroundColor: inputValue.trim() && !isLoading ? "#007cba" : "#c9cccf",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: inputValue.trim() && !isLoading ? "pointer" : "not-allowed",
                fontSize: "14px",
                fontWeight: "500",
              }}
            >
              {config.buttonText || "Send"}
            </button>
          </div>
        </BlockStack>
      </Card>
    </Page>
  );
}
