import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import OpenAI from "openai";

export const action = async ({ request }) => {
  console.log("🔍 Analytics API called");
  try {
    console.log("🔐 Authenticating...");
    const { admin, session } = await authenticate.admin(request);
    console.log("✅ Authentication successful:", session.shop);
    
    const formData = await request.formData();
    const question = formData.get("question");
    console.log("❓ Question:", question);

    // Get shop
    console.log("🏪 Finding shop...");
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      include: { botConfig: true },
    });
    console.log("✅ Shop found:", shop ? shop.shopDomain : "not found");

    if (!shop) {
      console.log("❌ Shop not found");
      return json({ error: "Shop not found" }, { status: 404 });
    }

    // Get analytics data
    console.log("📊 Fetching analytics data...");
    const [conversationAnalytics, popularQuestions, productAnalytics] = await Promise.all([
      prisma.conversationAnalytics.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.popularQuestions.findMany({
        where: { shopId: shop.id },
        orderBy: { frequency: 'desc' },
        take: 50,
      }),
      prisma.productAnalytics.findMany({
        where: { shopId: shop.id },
        orderBy: { timesRecommended: 'desc' },
        take: 50,
      }),
    ]);
    console.log("✅ Analytics data fetched:", {
      conversations: conversationAnalytics.length,
      questions: popularQuestions.length,
      products: productAnalytics.length
    });

    // Calculate summary statistics
    const totalConversations = conversationAnalytics.length;
    const purchaseConversations = conversationAnalytics.filter(c => c.outcome === 'purchase').length;
    const conversionRate = totalConversations > 0 ? (purchaseConversations / totalConversations * 100).toFixed(1) : 0;
    const avgDuration = conversationAnalytics.length > 0 ? 
      (conversationAnalytics.reduce((sum, c) => sum + c.duration, 0) / conversationAnalytics.length).toFixed(1) : 0;
    const totalRevenue = conversationAnalytics
      .filter(c => c.conversionValue)
      .reduce((sum, c) => sum + (c.conversionValue || 0), 0);

    // Prepare analytics context for AI
    const analyticsContext = {
      summary: {
        totalConversations,
        purchaseConversations,
        conversionRate: `${conversionRate}%`,
        avgDuration: `${avgDuration} minutes`,
        totalRevenue: `$${totalRevenue.toFixed(2)}`,
      },
      topQuestions: popularQuestions.slice(0, 10).map(q => ({
        question: q.question,
        frequency: q.frequency,
        successRate: `${(q.successRate * 100).toFixed(1)}%`,
      })),
      topProducts: productAnalytics.slice(0, 10).map(p => ({
        title: p.productTitle,
        timesRecommended: p.timesRecommended,
        timesViewed: p.timesViewed,
        timesPurchased: p.timesPurchased,
        conversionRate: `${(p.conversionRate * 100).toFixed(1)}%`,
        avgOrderValue: `$${p.avgOrderValue.toFixed(2)}`,
      })),
      recentConversations: conversationAnalytics.slice(0, 10).map(c => ({
        outcome: c.outcome,
        duration: `${c.duration} minutes`,
        messageCount: c.messageCount,
        satisfaction: c.customerSatisfaction,
        value: c.conversionValue ? `$${c.conversionValue.toFixed(2)}` : null,
      })),
    };

    // Check if OpenAI API key is configured
    const apiKey = shop.botConfig.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json({ error: "OpenAI API key not configured. Please add your API key in the bot configuration." });
    }

    // Create OpenAI client with the configured API key
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    // Create AI response
    console.log("🤖 Calling OpenAI...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: 'system',
          content: `You are an analytics AI assistant for ${shop.shopDomain}'s chatbot. 
          
You have access to comprehensive analytics data about customer conversations, popular questions, and product performance.

Your role is to:
1. Answer questions about chatbot performance with specific data
2. Provide actionable insights and recommendations
3. Identify trends and opportunities for improvement
4. Present data in a clear, business-focused way

ANALYTICS DATA:
${JSON.stringify(analyticsContext, null, 2)}

Guidelines:
- Always use specific numbers from the data
- Provide actionable recommendations
- Highlight both successes and areas for improvement
- Format responses for easy reading with bullet points and clear sections
- Be conversational but professional
- If asked about data you don't have, explain what data is available`,
        },
        {
          role: 'user',
          content: question,
        },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });

    const response = completion.choices[0].message.content;
    console.log("✅ OpenAI response received");

    return json({
      response,
      hasData: totalConversations > 0,
      summary: analyticsContext.summary,
    });

  } catch (error) {
    console.error("Analytics API error:", error);
    return json({ 
      error: "Sorry, I'm having trouble analyzing your data right now. Please try again." 
    }, { status: 500 });
  }
};
