import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");
  const theme = url.searchParams.get("theme") || "light";
  const position = url.searchParams.get("position") || "bottom-right";
  const language = url.searchParams.get("lang") || "en";

  if (!shopDomain) {
    throw new Response("Shop domain is required", { status: 400 });
  }

  // Load shop configuration to get dynamic bot name and settings
  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { botConfig: true },
  });

  if (!shop) {
    // Create shop with minimal default config if it doesn't exist
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        botConfig: {
          create: {
            // Only essential defaults, everything else comes from schema defaults
          },
        },
      },
      include: { botConfig: true },
    });
  }

  return json({
    shopDomain,
    theme,
    position,
    language,
    sessionId: uuidv4(),
    botConfig: shop.botConfig,
  });
};

export default function ChatBot() {
  const { shopDomain, theme, position, language, sessionId, botConfig } = useLoaderData();
  const [isOpen, setIsOpen] = useState(position === "hero" ? true : false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  
  // Generate browser fingerprint for customer recognition
  const generateFingerprint = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Browser fingerprint', 2, 2);
    
    return btoa(JSON.stringify({
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      screen: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      canvas: canvas.toDataURL()
    })).substring(0, 32);
  };
  
  // Initialize with welcome message
  useEffect(() => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: botConfig?.welcomeMessage || "Hello! I'm here to help you find the perfect products. What are you looking for today?",
        timestamp: new Date(),
      },
    ]);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage = {
      id: Date.now(),
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);

    // Send to API using fetch instead of fetcher for JSON
    const sendMessage = async () => {
      try {
        const formData = new FormData();
        formData.append("message", inputValue);
        formData.append("sessionId", sessionId);
        formData.append("fingerprint", generateFingerprint());
        
        const response = await fetch(`/api/chat?shop=${encodeURIComponent(shopDomain)}`, {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        
        if (data.error) {
          setMessages(prev => [...prev, {
            id: Date.now(),
            role: "assistant",
            content: "I apologize, but I'm having trouble right now. Please try again in a moment.",
            timestamp: new Date(),
          }]);
        } else {
          setMessages(prev => [...prev, {
            id: Date.now(),
            role: "assistant",
            content: data.message,
            metadata: data.metadata,
            timestamp: new Date(),
          }]);
        }
      } catch (error) {
        console.error("Chat error:", error);
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: "assistant",
          content: "I apologize, but I'm having trouble right now. Please try again in a moment.",
          timestamp: new Date(),
        }]);
      }
      setIsTyping(false);
    };

    sendMessage();
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleChat = () => {
    setIsOpen(!isOpen);
  };

  const formatMessage = (content) => {
    // Simple formatting for better readability
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');
  };

  const themeStyles = {
    light: {
      primary: "#007cba",
      secondary: "#f8f9fa",
      text: "#333333",
      border: "#e1e5e9",
      background: "#ffffff",
      userBubble: "#007cba",
      assistantBubble: "#f1f3f4",
    },
    dark: {
      primary: "#4a9eff",
      secondary: "#2d3748",
      text: "#e2e8f0",
      border: "#4a5568",
      background: "#1a202c",
      userBubble: "#4a9eff",
      assistantBubble: "#2d3748",
    },
  };

  const currentTheme = themeStyles[theme] || themeStyles.light;

  const containerStyle = position === "hero" ? {
    width: "100%",
    height: "100vh",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: currentTheme.background,
  } : {
    position: "fixed",
    bottom: position.includes("bottom") ? "20px" : "auto",
    top: position.includes("top") ? "20px" : "auto",
    right: position.includes("right") ? "20px" : "auto",
    left: position.includes("left") ? "20px" : "auto",
    zIndex: 9999,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  };

  return (
    <div style={containerStyle}>
      {/* Chat Button */}
      {!isOpen && (
        <button
          onClick={toggleChat}
          style={{
            width: "60px",
            height: "60px",
            borderRadius: "50%",
            backgroundColor: currentTheme.primary,
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
            transition: "all 0.3s ease",
          }}
          onMouseOver={(e) => {
            e.target.style.transform = "scale(1.1)";
          }}
          onMouseOut={(e) => {
            e.target.style.transform = "scale(1)";
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div
          style={{
            width: position === "hero" ? "100%" : "350px",
            height: position === "hero" ? "100%" : "500px",
            maxWidth: position === "hero" ? "800px" : "350px",
            backgroundColor: currentTheme.background,
            border: position === "hero" ? "none" : `1px solid ${currentTheme.border}`,
            borderRadius: position === "hero" ? "0" : "12px",
            boxShadow: position === "hero" ? "none" : "0 8px 24px rgba(0, 0, 0, 0.15)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "16px",
              backgroundColor: currentTheme.primary,
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  backgroundColor: "#4ade80",
                  borderRadius: "50%",
                }}
              />
              <span style={{ fontWeight: "600", fontSize: "14px" }}>
                {botConfig?.botName || "Shop Assistant"}
              </span>
            </div>
            <button
              onClick={toggleChat}
              style={{
                background: "none",
                border: "none",
                color: "white",
                cursor: "pointer",
                fontSize: "18px",
                padding: "0",
                width: "24px",
                height: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              padding: "16px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {messages.map((message) => (
              <div
                key={message.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: message.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "12px 16px",
                    borderRadius: "18px",
                    backgroundColor:
                      message.role === "user"
                        ? currentTheme.userBubble
                        : currentTheme.assistantBubble,
                    color:
                      message.role === "user"
                        ? "white"
                        : currentTheme.text,
                    fontSize: "14px",
                    lineHeight: "1.4",
                    wordWrap: "break-word",
                  }}
                  dangerouslySetInnerHTML={{
                    __html: formatMessage(message.content),
                  }}
                />
                {message.metadata && message.metadata.products && (
                  <div style={{ marginTop: "8px", maxWidth: "100%" }}>
                    {message.metadata.products.slice(0, 6).map((product) => (
                      <div
                        key={product.id}
                        style={{
                          backgroundColor: currentTheme.secondary,
                          border: `1px solid ${currentTheme.border}`,
                          borderRadius: "12px",
                          padding: "12px",
                          marginBottom: "8px",
                          fontSize: "13px",
                          display: "flex",
                          gap: "12px",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        }}
                        onMouseOver={(e) => {
                          e.target.style.transform = "scale(1.02)";
                          e.target.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
                        }}
                        onMouseOut={(e) => {
                          e.target.style.transform = "scale(1)";
                          e.target.style.boxShadow = "none";
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
                            whiteSpace: "nowrap"
                          }}>
                            {product.title}
                          </div>
                          {product.description && (
                            <div style={{ 
                              color: currentTheme.text, 
                              opacity: 0.8,
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
                              color: currentTheme.primary, 
                              fontWeight: "700",
                              fontSize: "14px"
                            }}>
                              ${product.price}
                            </div>
                            {product.compareAtPrice && parseFloat(product.compareAtPrice) > parseFloat(product.price) && (
                              <div style={{ 
                                color: currentTheme.text, 
                                opacity: 0.6,
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
            ))}
            {isTyping && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "18px",
                    backgroundColor: currentTheme.assistantBubble,
                    display: "flex",
                    gap: "4px",
                  }}
                >
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      backgroundColor: currentTheme.text,
                      borderRadius: "50%",
                      animation: "pulse 1.4s ease-in-out infinite both",
                    }}
                  />
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      backgroundColor: currentTheme.text,
                      borderRadius: "50%",
                      animation: "pulse 1.4s ease-in-out 0.2s infinite both",
                    }}
                  />
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      backgroundColor: currentTheme.text,
                      borderRadius: "50%",
                      animation: "pulse 1.4s ease-in-out 0.4s infinite both",
                    }}
                  />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: "16px",
              borderTop: `1px solid ${currentTheme.border}`,
              display: "flex",
              gap: "8px",
            }}
          >
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={botConfig?.placeholderText || "Ask me anything about our products..."}
              style={{
                flex: 1,
                border: `1px solid ${currentTheme.border}`,
                borderRadius: "20px",
                padding: "12px 16px",
                fontSize: "14px",
                resize: "none",
                outline: "none",
                backgroundColor: currentTheme.background,
                color: currentTheme.text,
                minHeight: "20px",
                maxHeight: "80px",
                fontFamily: "inherit",
              }}
              rows="1"
            />
            <button
              onClick={sendMessage}
              disabled={!inputValue.trim() || isTyping}
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                backgroundColor: inputValue.trim() && !isTyping ? currentTheme.primary : currentTheme.border,
                border: "none",
                cursor: inputValue.trim() && !isTyping ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22,2 15,22 11,13 2,9 22,2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* CSS Animations */}
      <style>
        {`
          @keyframes pulse {
            0%, 80%, 100% {
              opacity: 0.3;
            }
            40% {
              opacity: 1;
            }
          }
        `}
      </style>
    </div>
  );
}
