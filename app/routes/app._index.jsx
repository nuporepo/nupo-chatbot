import { useEffect, useState, useRef } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  TextField,
  Select,
  Checkbox,
  Banner,
  InlineStack,
  Badge,
  List,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Helper function to generate CSS positioning for popup chatbots
function getPopupPositionStyle(position) {
  switch(position) {
    case "bottom-right":
      return "bottom: 20px; right: 20px;";
    case "bottom-left":
      return "bottom: 20px; left: 20px;";
    case "top-right":
      return "top: 20px; right: 20px;";
    case "top-left":
      return "top: 20px; left: 20px;";
    default:
      return "bottom: 20px; right: 20px;";
  }
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Get or create shop configuration
  let shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: {
      botConfig: true,
      knowledgeBase: true,
      chatSessions: {
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
        include: {
          messages: true,
        },
      },
    },
  });

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain: session.shop,
        botConfig: {
          create: {
            // Only essential defaults, everything else comes from admin config
          },
        },
      },
      include: {
        botConfig: true,
        knowledgeBase: true,
        chatSessions: {
          include: {
            messages: true,
          },
        },
      },
    });
  }

  // Calculate stats
  const totalSessions = shop.chatSessions.length;
  const totalMessages = shop.chatSessions.reduce((acc, session) => acc + session.messages.length, 0);
  const activeToday = shop.chatSessions.filter(session => 
    session.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000)
  ).length;

  return {
    shop,
    stats: {
      totalSessions,
      totalMessages,
      activeToday,
    },
    embedCode: shop.botConfig?.position === "hero" 
      ? `<!-- Embedded Chatbot (Hero Section) -->
<iframe 
  src="${process.env.SHOPIFY_APP_URL}/chatbot?shop=${session.shop}&theme=light&position=hero"
  width="100%" 
  height="600" 
  frameborder="0"
  style="border-radius: 8px; max-width: 800px; margin: 0 auto; display: block;"
  title="${shop.botConfig?.chatTitle || 'Shop Assistant'}">
</iframe>`
      : `<!-- Popup Chatbot (Floating Widget) -->
<iframe 
  src="${process.env.SHOPIFY_APP_URL}/chatbot?shop=${session.shop}&theme=light&position=${shop.botConfig?.position || 'bottom-right'}"
  width="100%" 
  height="600" 
  frameborder="0"
  style="position: fixed; ${getPopupPositionStyle(shop.botConfig?.position || 'bottom-right')} width: 350px; height: 500px; border-radius: 12px; z-index: 9999;"
  title="${shop.botConfig?.chatTitle || 'Shop Assistant'}">
</iframe>`,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "updateConfig") {
    const botName = formData.get("botName");
    const welcomeMessage = formData.get("welcomeMessage");
    const systemPrompt = formData.get("systemPrompt");
    const errorMessage = formData.get("errorMessage");
    const typingMessage = formData.get("typingMessage");
    const placeholderText = formData.get("placeholderText");
    const buttonText = formData.get("buttonText");
    const chatTitle = formData.get("chatTitle");
    const temperature = parseFloat(formData.get("temperature"));
    const isActive = formData.get("isActive") === "true";
    const openaiApiKey = formData.get("openaiApiKey");
    const position = formData.get("position");
    // Learning Options
    const enableCustomerMemory = formData.get("enableCustomerMemory") === "true";
    const enableConversationAnalytics = formData.get("enableConversationAnalytics") === "true";
    const enableAutoKnowledgeGeneration = formData.get("enableAutoKnowledgeGeneration") === "true";
    const enablePerformanceOptimization = formData.get("enablePerformanceOptimization") === "true";

    // Find the shop first
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      include: { botConfig: true },
    });

    if (shop && shop.botConfig) {
      // Update existing config
      await prisma.botConfig.update({
        where: { id: shop.botConfig.id },
        data: {
          botName,
          welcomeMessage,
          systemPrompt,
          errorMessage,
          typingMessage,
          placeholderText,
          buttonText,
          chatTitle,
          temperature,
          isActive,
          openaiApiKey,
          position,
          // Learning Options
          enableCustomerMemory,
          enableConversationAnalytics,
          enableAutoKnowledgeGeneration,
          enablePerformanceOptimization,
        },
      });
    } else {
      // Create new config if it doesn't exist
      await prisma.botConfig.create({
        data: {
          shopId: shop.id,
          botName,
          welcomeMessage,
          systemPrompt,
          errorMessage,
          typingMessage,
          placeholderText,
          buttonText,
          chatTitle,
          temperature,
          isActive,
          openaiApiKey,
          position,
          // Learning Options
          enableCustomerMemory,
          enableConversationAnalytics,
          enableAutoKnowledgeGeneration,
          enablePerformanceOptimization,
        },
      });
    }

    return { success: true, message: "Configuration updated successfully!" };
  }

  if (action === "trainBot") {
    const title = formData.get("title");
    const content = formData.get("content");
    const category = formData.get("category");

    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
    });

    await prisma.knowledgeBase.create({
      data: {
        shopId: shop.id,
        title,
        content,
        category,
      },
    });

    return { success: true, message: "Knowledge added successfully!" };
  }

  return { error: "Invalid action" };
};

export default function Index() {
  const { shop, stats, embedCode } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [config, setConfig] = useState({
    botName: shop.botConfig?.botName || "Shop Assistant",
    welcomeMessage: shop.botConfig?.welcomeMessage || "",
    systemPrompt: shop.botConfig?.systemPrompt || "",
    errorMessage: shop.botConfig?.errorMessage || "",
    typingMessage: shop.botConfig?.typingMessage || "",
    placeholderText: shop.botConfig?.placeholderText || "",
    buttonText: shop.botConfig?.buttonText || "",
    chatTitle: shop.botConfig?.chatTitle || "",
    temperature: shop.botConfig?.temperature || 0.7,
    isActive: shop.botConfig?.isActive ?? true,
    openaiApiKey: shop.botConfig?.openaiApiKey || "",
    position: shop.botConfig?.position || "bottom-right",
    // Learning Options
    enableCustomerMemory: shop.botConfig?.enableCustomerMemory ?? false,
    enableConversationAnalytics: shop.botConfig?.enableConversationAnalytics ?? true,
    enableAutoKnowledgeGeneration: shop.botConfig?.enableAutoKnowledgeGeneration ?? false,
    enablePerformanceOptimization: shop.botConfig?.enablePerformanceOptimization ?? false,
  });
  const [knowledgeForm, setKnowledgeForm] = useState({
    title: "",
    content: "",
    category: "general",
  });

  const isLoading = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleConfigSubmit = () => {
    const formData = new FormData();
    formData.append("action", "updateConfig");
    formData.append("botName", config.botName);
    formData.append("welcomeMessage", config.welcomeMessage);
    formData.append("systemPrompt", config.systemPrompt);
    formData.append("errorMessage", config.errorMessage);
    formData.append("typingMessage", config.typingMessage);
    formData.append("placeholderText", config.placeholderText);
    formData.append("buttonText", config.buttonText);
    formData.append("chatTitle", config.chatTitle);
    formData.append("temperature", config.temperature.toString());
    formData.append("isActive", config.isActive.toString());
    formData.append("openaiApiKey", config.openaiApiKey);
    formData.append("position", config.position);
    // Learning Options
    formData.append("enableCustomerMemory", config.enableCustomerMemory.toString());
    formData.append("enableConversationAnalytics", config.enableConversationAnalytics.toString());
    formData.append("enableAutoKnowledgeGeneration", config.enableAutoKnowledgeGeneration.toString());
    formData.append("enablePerformanceOptimization", config.enablePerformanceOptimization.toString());
    
    fetcher.submit(formData, { method: "POST" });
  };

  const handleKnowledgeSubmit = () => {
    const formData = new FormData();
    formData.append("action", "trainBot");
    formData.append("title", knowledgeForm.title);
    formData.append("content", knowledgeForm.content);
    formData.append("category", knowledgeForm.category);
    
    fetcher.submit(formData, { method: "POST" });
    setKnowledgeForm({ title: "", content: "", category: "general" });
  };

  const copyEmbedCode = () => {
    navigator.clipboard.writeText(embedCode);
    shopify.toast.show("Embed code copied to clipboard!");
  };

  return (
    <Page>
      <TitleBar title="Shop Chatbot - Waiter Assistant">
        <Button
          variant={shop.botConfig?.isActive ? "primary" : "secondary"}
          tone={shop.botConfig?.isActive ? "success" : "critical"}
        >
          {shop.botConfig?.isActive ? "Active" : "Inactive"}
        </Button>
      </TitleBar>

      <Layout>
        <Layout.Section>
          {/* Navigation Tabs */}
          <Card>
            <InlineStack gap="200">
              <Button 
                pressed={activeTab === "dashboard"}
                onClick={() => setActiveTab("dashboard")}
              >
                Dashboard
              </Button>
              <Button 
                pressed={activeTab === "config"}
                onClick={() => setActiveTab("config")}
              >
                Configuration
              </Button>
              <Button 
                pressed={activeTab === "training"}
                onClick={() => setActiveTab("training")}
              >
                Training
              </Button>
              <Button 
                pressed={activeTab === "analytics"}
                onClick={() => setActiveTab("analytics")}
              >
                Analytics Chat
              </Button>
              <Button 
                pressed={activeTab === "scraping"}
                onClick={() => setActiveTab("scraping")}
              >
                Content Scraping
              </Button>
              <Button 
                pressed={activeTab === "embed"}
                onClick={() => setActiveTab("embed")}
              >
                Embed Code
              </Button>
            </InlineStack>
          </Card>

          {/* Dashboard Tab */}
          {activeTab === "dashboard" && (
      <BlockStack gap="500">
        <Layout>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Chat Sessions</Text>
                      <Text as="p" variant="displayLarge">{stats.totalSessions}</Text>
                      <Badge tone="info">Last 7 days</Badge>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Total Messages</Text>
                      <Text as="p" variant="displayLarge">{stats.totalMessages}</Text>
                      <Badge tone="success">All time</Badge>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Active Today</Text>
                      <Text as="p" variant="displayLarge">{stats.activeToday}</Text>
                      <Badge tone="attention">Today</Badge>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Welcome to Your Waiter Chatbot!</Text>
                  <Text variant="bodyMd">
                    Your AI-powered shopping assistant works like a professional waiter, helping customers 
                    browse products, make recommendations, manage their cart, and handle everything except payment. 
                    The chatbot can be embedded on any page as an iframe and will automatically detect your 
                    store's language.
                  </Text>
                  
                  <Banner title="Key Features">
                    <Text as="p">
                      • Product browsing and recommendations<br/>
                      • Cart management and discount application<br/>
                      • Shipping calculations and options<br/>
                      • Self-training from successful conversations<br/>
                      • Multi-language support<br/>
                      • Hero-embedded iframe interface
                    </Text>
                  </Banner>
                </BlockStack>
              </Card>
            </BlockStack>
          )}

          {/* Configuration Tab */}
          {activeTab === "config" && (
            <Card>
              <BlockStack gap="500">
                <Text as="h2" variant="headingMd">Bot Configuration</Text>
                
                <TextField
                  label="Bot Name"
                  value={config.botName}
                  onChange={(value) => setConfig(prev => ({ ...prev, botName: value }))}
                  helpText="The name your customers will see"
                />

                <TextField
                  label="Welcome Message"
                  value={config.welcomeMessage}
                  onChange={(value) => setConfig(prev => ({ ...prev, welcomeMessage: value }))}
                  multiline={3}
                  helpText="The first message customers see when they open the chat"
                />

                <TextField
                  label="System Prompt"
                  value={config.systemPrompt}
                  onChange={(value) => setConfig(prev => ({ ...prev, systemPrompt: value }))}
                  multiline={5}
                  helpText="Instructions for how the AI should behave (advanced users only)"
                />

                <TextField
                  label="Chat Title"
                  value={config.chatTitle}
                  onChange={(value) => setConfig(prev => ({ ...prev, chatTitle: value }))}
                  helpText="Title shown in the chat header"
                />

                <TextField
                  label="Error Message"
                  value={config.errorMessage}
                  onChange={(value) => setConfig(prev => ({ ...prev, errorMessage: value }))}
                  multiline={2}
                  helpText="Message shown when the bot encounters an error"
                />

                <TextField
                  label="Typing Indicator"
                  value={config.typingMessage}
                  onChange={(value) => setConfig(prev => ({ ...prev, typingMessage: value }))}
                  helpText="Message shown while the bot is thinking"
                />

                <TextField
                  label="Input Placeholder"
                  value={config.placeholderText}
                  onChange={(value) => setConfig(prev => ({ ...prev, placeholderText: value }))}
                  helpText="Placeholder text in the message input field"
                />

                <TextField
                  label="Send Button Text"
                  value={config.buttonText}
                  onChange={(value) => setConfig(prev => ({ ...prev, buttonText: value }))}
                  helpText="Text shown on the send button"
                />

                <TextField
                  label="AI Temperature"
                  type="number"
                  value={config.temperature.toString()}
                  onChange={(value) => setConfig(prev => ({ ...prev, temperature: parseFloat(value) || 0.7 }))}
                  min="0"
                  max="1"
                  step="0.1"
                  helpText="Controls creativity (0 = focused, 1 = creative)"
                />

                <Checkbox
                  label="Bot Active"
                  checked={config.isActive}
                  onChange={(checked) => setConfig(prev => ({ ...prev, isActive: checked }))}
                  helpText="Turn the chatbot on or off"
                />

                <TextField
                  label="OpenAI API Key"
                  type="password"
                  value={config.openaiApiKey || ""}
                  onChange={(value) => setConfig(prev => ({ ...prev, openaiApiKey: value }))}
                  helpText="Your OpenAI API key for powering the chatbot (stored securely)"
                  placeholder="sk-..."
                />

                <Select
                  label="Chatbot Position"
                  options={[
                    { label: "Popup - Bottom Right", value: "bottom-right" },
                    { label: "Popup - Bottom Left", value: "bottom-left" },
                    { label: "Popup - Top Right", value: "top-right" },
                    { label: "Popup - Top Left", value: "top-left" },
                    { label: "Embedded - Hero Section", value: "hero" },
                  ]}
                  value={config.position || "bottom-right"}
                  onChange={(value) => setConfig(prev => ({ ...prev, position: value }))}
                  helpText="Choose how the chatbot appears on your store pages. Popup positions show a floating chat button, embedded shows the chat directly on the page."
                />

                <Text variant="headingMd" as="h3">Learning Options</Text>
                
                <BlockStack gap="400">
                  <Checkbox
                    label="Customer Memory"
                    checked={config.enableCustomerMemory}
                    onChange={(checked) => setConfig(prev => ({ ...prev, enableCustomerMemory: checked }))}
                    helpText="Remember returning customers using browser fingerprinting"
                  />
                  <Text variant="bodyMd" tone="subdued">
                    <strong>What's saved:</strong> Browser fingerprint (device info, screen size, timezone) to recognize returning visitors.<br/>
                    <strong>How it works:</strong> When enabled, the bot queries your Shopify order history to find the customer's previous purchases and personalizes responses. No personal data is stored in our database - we only query your existing Shopify customer data.<br/>
                    <strong>Privacy:</strong> Uses anonymous browser fingerprinting. Customer emails are only retrieved from your Shopify orders when they return.
                  </Text>
                </BlockStack>

                <BlockStack gap="400">
                  <Checkbox
                    label="Conversation Analytics"
                    checked={config.enableConversationAnalytics}
                    onChange={(checked) => setConfig(prev => ({ ...prev, enableConversationAnalytics: checked }))}
                    helpText="Track conversation patterns and successful interactions (recommended)"
                  />
                  <Text variant="bodyMd" tone="subdued">
                    <strong>What's saved:</strong> Chat messages, response times, conversation outcomes (purchase/abandoned/info-only), product recommendations, customer questions, and conversation duration.<br/>
                    <strong>How it works:</strong> Tracks every conversation to identify patterns - which questions are asked most, which products get recommended vs purchased, average conversation length, and success rates. Creates analytics you can query through the "Analytics Chat" feature.<br/>
                    <strong>Benefit:</strong> Get actionable insights like "customers who ask about X buy Y" or "conversations longer than 10 minutes have 60% higher conversion rates". Use the Analytics Chat to ask questions like "What are my top 5 most asked questions?" or "Which products should I promote more?"
                  </Text>
                </BlockStack>

                <BlockStack gap="400">
                  <Checkbox
                    label="Auto Knowledge Generation"
                    checked={config.enableAutoKnowledgeGeneration}
                    onChange={(checked) => setConfig(prev => ({ ...prev, enableAutoKnowledgeGeneration: checked }))}
                    helpText="Learn from successful conversations to improve responses"
                  />
                  <Text variant="bodyMd" tone="subdued">
                    <strong>What's saved:</strong> Successful conversation patterns that led to purchases or positive outcomes.<br/>
                    <strong>How it works:</strong> When customers buy after specific bot recommendations, those responses are saved as "knowledge entries" to train future conversations.<br/>
                    <strong>Benefit:</strong> Bot automatically learns from successful sales interactions and becomes better at converting visitors to customers.
                  </Text>
                </BlockStack>

                <BlockStack gap="400">
                  <Checkbox
                    label="Performance Optimization"
                    checked={config.enablePerformanceOptimization}
                    onChange={(checked) => setConfig(prev => ({ ...prev, enablePerformanceOptimization: checked }))}
                    helpText="A/B test and optimize responses for better conversion rates"
                  />
                  <Text variant="bodyMd" tone="subdued">
                    <strong>What's saved:</strong> Different response variations and their success rates (conversions, engagement time).<br/>
                    <strong>How it works:</strong> Tests different ways of presenting products or answering questions, then automatically uses the most effective responses.<br/>
                    <strong>Benefit:</strong> Continuously improves sales performance by learning which communication styles work best for your customers.
                  </Text>
                </BlockStack>

                <InlineStack gap="200">
                  <Button 
                    primary 
                    loading={isLoading}
                    onClick={handleConfigSubmit}
                  >
                    Save Configuration
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          )}

          {/* Training Tab */}
          {activeTab === "training" && (
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="500">
                  <Text as="h2" variant="headingMd">Train Your Bot</Text>
                  <Text variant="bodyMd">
                    Add knowledge to help your bot better understand your products and business. 
                    The bot will automatically learn from your entire site, but you can add specific 
                    information here.
                  </Text>

                  <TextField
                    label="Knowledge Title"
                    value={knowledgeForm.title}
                    onChange={(value) => setKnowledgeForm(prev => ({ ...prev, title: value }))}
                    placeholder="e.g., Product Care Instructions"
                  />

                  <Select
                    label="Category"
                    options={[
                      { label: "General", value: "general" },
                      { label: "Products", value: "products" },
                      { label: "Shipping", value: "shipping" },
                      { label: "Returns", value: "returns" },
                      { label: "FAQ", value: "faq" },
                    ]}
                    value={knowledgeForm.category}
                    onChange={(value) => setKnowledgeForm(prev => ({ ...prev, category: value }))}
                  />

                  <TextField
                    label="Content"
                    value={knowledgeForm.content}
                    onChange={(value) => setKnowledgeForm(prev => ({ ...prev, content: value }))}
                    multiline={5}
                    placeholder="Enter the information you want the bot to know..."
                  />

                  <InlineStack gap="200">
                    <Button 
                      primary 
                      loading={isLoading}
                      onClick={handleKnowledgeSubmit}
                      disabled={!knowledgeForm.title || !knowledgeForm.content}
                    >
                      Add Knowledge
                    </Button>
                    </InlineStack>
                </BlockStack>
              </Card>

              {shop.knowledgeBase.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">Existing Knowledge ({shop.knowledgeBase.length})</Text>
                    {shop.knowledgeBase.slice(0, 5).map((kb) => (
                      <Box key={kb.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100">
                          <InlineStack gap="200" align="space-between">
                            <Text variant="headingSm">{kb.title}</Text>
                            <Badge>{kb.category}</Badge>
                          </InlineStack>
                          <Text variant="bodySm" color="subdued">
                            {kb.content.substring(0, 100)}...
                          </Text>
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          )}

          {/* Analytics Chat Tab */}
          {activeTab === "analytics" && (
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Analytics Chat</Text>
                
                <Text variant="bodyMd">
                  Ask questions about your chatbot's performance and get AI-powered insights.
                </Text>

                <AnalyticsChat />
              </BlockStack>
            </Card>
          )}

          {/* Content Scraping Tab */}
          {activeTab === "scraping" && (
            <ScrapingTab shop={shop} />
          )}

          {/* Embed Code Tab */}
          {activeTab === "embed" && (
            <Card>
              <BlockStack gap="500">
                <Text as="h2" variant="headingMd">Embed Your Chatbot</Text>
                <Text variant="bodyMd">
                  Copy this code and paste it into any webpage where you want the chatbot to appear. 
                  The chatbot will automatically detect your store's language and display appropriately.
                </Text>

                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                  <pre style={{ 
                    margin: 0, 
                    fontSize: "12px", 
                    lineHeight: "1.4",
                    wordWrap: "break-word",
                    whiteSpace: "pre-wrap"
                  }}>
                    <code>{embedCode}</code>
                  </pre>
                </Box>

                <Button primary onClick={copyEmbedCode}>
                  Copy Embed Code
                </Button>

                <Banner title="Integration Instructions">
                  <Text as="p">
                    The embed code above automatically uses your configured position setting:
                  </Text>
                  <List type="bullet">
                    <List.Item><strong>Popup positions</strong> (Bottom Right, Top Left, etc.) - Shows a floating chat button that customers can click to open the chat window</List.Item>
                    <List.Item><strong>Hero Section</strong> - Embeds the chat directly into your page as an inline element</List.Item>
                  </List>
                  <Text as="p">
                    Simply copy and paste the code into your store's theme files where you want the chatbot to appear.
                  </Text>
                </Banner>
            </BlockStack>
            </Card>
          )}
          </Layout.Section>
        </Layout>
    </Page>
  );
}

// Analytics Chat Component
function AnalyticsChat() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fetcher = useFetcher();
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    // Send to analytics API
    const formData = new FormData();
    formData.append('question', userMessage);

    fetcher.submit(formData, {
      method: 'POST',
      action: '/api/analytics',
    });
  };

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') {
      if (fetcher.data.response) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: fetcher.data.response,
          hasData: fetcher.data.hasData,
          summary: fetcher.data.summary
        }]);
      } else if (fetcher.data.error) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: fetcher.data.error,
          isError: true
        }]);
      }
      setIsLoading(false);
    }
  }, [fetcher.data, fetcher.state]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quickQuestions = [
    "What are my top 5 most asked questions?",
    "What's my conversion rate?",
    "Which products perform best?",
    "How long do conversations last?",
    "What should I improve?"
  ];

  return (
    <div>
      {/* Chat Messages */}
      <div style={{ 
        height: "400px", 
        overflowY: "auto", 
        border: "1px solid #e1e3e5", 
        borderRadius: "8px", 
        padding: "16px",
        backgroundColor: "#fafbfb",
        marginBottom: "16px"
      }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "#6d7175" }}>
            <Text variant="bodyMd">
              👋 Hi! I'm your analytics assistant. Ask me anything about your chatbot's performance!
            </Text>
            <div style={{ marginTop: "20px" }}>
              <Text variant="bodySm" tone="subdued">
                Try asking: "What are my most popular questions?" or "How is my conversion rate?"
              </Text>
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={index} style={{ 
              marginBottom: "16px",
              padding: "12px",
              borderRadius: "8px",
              backgroundColor: message.role === 'user' ? "#005bd3" : "#ffffff",
              color: message.role === 'user' ? "white" : "#202223",
              border: message.role === 'assistant' ? "1px solid #e1e3e5" : "none",
              marginLeft: message.role === 'user' ? "60px" : "0",
              marginRight: message.role === 'assistant' ? "60px" : "0",
            }}>
              <Text variant="bodyMd" style={{ 
                color: message.role === 'user' ? "white" : "#202223",
                whiteSpace: "pre-wrap"
              }}>
                {message.content}
              </Text>
              {message.summary && (
                <div style={{ 
                  marginTop: "12px", 
                  padding: "8px", 
                  backgroundColor: "#f6f6f7", 
                  borderRadius: "4px",
                  fontSize: "12px"
                }}>
                  <strong>Quick Stats:</strong> {message.summary.totalConversations} conversations, {message.summary.conversionRate} conversion rate
                </div>
              )}
            </div>
          ))
        )}
        
        {isLoading && (
          <div style={{ 
            padding: "12px",
            backgroundColor: "#ffffff",
            border: "1px solid #e1e3e5",
            borderRadius: "8px",
            marginRight: "60px"
          }}>
            <Text variant="bodyMd" tone="subdued">
              🤔 Analyzing your data...
            </Text>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Questions */}
      <div style={{ marginBottom: "16px" }}>
        <Text variant="bodySm" tone="subdued" style={{ marginBottom: "8px" }}>
          Quick questions:
        </Text>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {quickQuestions.map((question, index) => (
            <button
              key={index}
              onClick={() => setInputValue(question)}
              style={{
                padding: "6px 12px",
                backgroundColor: "#f6f6f7",
                border: "1px solid #c9cccf",
                borderRadius: "16px",
                fontSize: "12px",
                cursor: "pointer",
                color: "#202223"
              }}
            >
              {question}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          placeholder="Ask about your chatbot analytics..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: "12px 16px",
            border: "1px solid #c9cccf",
            borderRadius: "6px",
            fontSize: "14px",
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!inputValue.trim() || isLoading}
          style={{
            padding: "12px 24px",
            backgroundColor: inputValue.trim() && !isLoading ? "#005bd3" : "#c9cccf",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: inputValue.trim() && !isLoading ? "pointer" : "not-allowed",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          {isLoading ? "..." : "Ask"}
        </button>
      </div>
    </div>
  );
}

// Scraping Tab Component
function ScrapingTab({ shop }) {
  const fetcher = useFetcher();
  const [scrapingStatus, setScrapingStatus] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  // Poll for scraping status
  useEffect(() => {
    if (isPolling) {
      const interval = setInterval(() => {
        fetcher.submit(
          { action: "get_status" },
          { method: "post", action: "/api/scrape" }
        );
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [isPolling, fetcher]);

  // Handle fetcher results
  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.latestJob) {
        setScrapingStatus(fetcher.data);
        
        // Stop polling if job is complete
        if (fetcher.data.latestJob.status !== 'running') {
          setIsPolling(false);
        }
      }
    }
  }, [fetcher.data]);

  const startScraping = () => {
    setIsPolling(true);
    fetcher.submit(
      { action: "start_scrape" },
      { method: "post", action: "/api/scrape" }
    );
  };

  const getStatus = () => {
    fetcher.submit(
      { action: "get_status" },
      { method: "post", action: "/api/scrape" }
    );
  };

  const isLoading = fetcher.state === "submitting";
  const latestJob = scrapingStatus?.latestJob;
  const contentStats = scrapingStatus?.contentStats || {};

  return (
    <Card>
      <BlockStack gap="500">
        <Text as="h2" variant="headingMd">Content Scraping</Text>
        
        <Text variant="bodyMd" color="subdued">
          Scrape your entire shop to make the AI aware of all products, blog articles, and collections. 
          This helps the AI provide more accurate and comprehensive answers to customers.
        </Text>
        
        <Banner tone="info">
          <Text variant="bodyMd">
            <strong>🤖 Auto-Scraping Enabled:</strong> Your shop content is automatically re-scraped every 24 hours 
            when customers interact with the chatbot. This keeps your AI up-to-date with the latest products and content.
            <br/><br/>
            <strong>Data Override:</strong> Each scraping completely replaces old data with fresh content from your shop.
          </Text>
        </Banner>

        {/* Current Status */}
        <Card background="bg-surface-secondary">
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Current Status</Text>
            
            {latestJob ? (
              <BlockStack gap="200">
                <InlineStack gap="200" align="space-between">
                  <Text variant="bodyMd">Last Job:</Text>
                  <Badge tone={
                    latestJob.status === 'completed' ? 'success' :
                    latestJob.status === 'running' ? 'info' :
                    latestJob.status === 'failed' ? 'critical' : 'attention'
                  }>
                    {latestJob.status.toUpperCase()}
                  </Badge>
                </InlineStack>
                
                {latestJob.status === 'running' && (
                  <ProgressBar progress={latestJob.progress || 0} size="small" />
                )}
                
                {latestJob.status === 'completed' && (
                  <InlineStack gap="200" align="space-between">
                    <Text variant="bodyMd">Items Processed:</Text>
                    <Text variant="bodyMd" fontWeight="semibold">{latestJob.itemsProcessed || 0}</Text>
                  </InlineStack>
                )}
                
                {latestJob.errorMessage && (
                  <Text variant="bodyMd" tone="critical">{latestJob.errorMessage}</Text>
                )}
                
                <Text variant="bodySm" color="subdued">
                  {latestJob.completedAt ? 
                    `Completed: ${new Date(latestJob.completedAt).toLocaleString()}` :
                    latestJob.startedAt ? 
                    `Started: ${new Date(latestJob.startedAt).toLocaleString()}` :
                    `Created: ${new Date(latestJob.createdAt).toLocaleString()}`
                  }
                </Text>
              </BlockStack>
            ) : (
              <Text variant="bodyMd" color="subdued">No scraping jobs yet</Text>
            )}
          </BlockStack>
        </Card>

        {/* Content Statistics */}
        {Object.keys(contentStats).length > 0 && (
          <Card background="bg-surface-secondary">
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Scraped Content</Text>
              
              <InlineStack gap="400" wrap>
                {contentStats.product && (
                  <div>
                    <Text variant="headingMd" color="success">{contentStats.product}</Text>
                    <Text variant="bodySm" color="subdued">Products</Text>
                  </div>
                )}
                
                {contentStats.article && (
                  <div>
                    <Text variant="headingMd" color="info">{contentStats.article}</Text>
                    <Text variant="bodySm" color="subdued">Articles</Text>
                  </div>
                )}
                
                {contentStats.collection && (
                  <div>
                    <Text variant="headingMd" color="warning">{contentStats.collection}</Text>
                    <Text variant="bodySm" color="subdued">Collections</Text>
                  </div>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Actions */}
        <InlineStack gap="300">
          <Button
            variant="primary"
            loading={isLoading && fetcher.formData?.get("action") === "start_scrape"}
            disabled={latestJob?.status === 'running'}
            onClick={startScraping}
          >
            {latestJob?.status === 'running' ? 'Scraping...' : 'Start Full Scrape'}
          </Button>
          
          <Button
            loading={isLoading && fetcher.formData?.get("action") === "get_status"}
            onClick={getStatus}
          >
            Refresh Status
          </Button>
        </InlineStack>

        {/* Help Text */}
        <Text variant="bodySm" color="subdued">
          <strong>What gets scraped:</strong><br/>
          • All products (titles, descriptions, tags, variants)<br/>
          • Blog articles (content, tags, author info)<br/>
          • Collections (titles, descriptions)<br/>
          • SEO content and keywords for better search<br/><br/>
          
          <strong>How it helps:</strong><br/>
          The AI can now answer questions about your products, reference your blog articles, 
          and provide comprehensive information based on all your shop content.
        </Text>
      </BlockStack>
    </Card>
  );
}
