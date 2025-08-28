# Shop Chatbot Setup Guide

## 🎉 Congratulations!

Your waiter-style Shopify chatbot is now ready! This AI assistant works like a professional waiter, helping customers browse products, make recommendations, manage carts, and handle everything except payment.

## 🚀 Quick Start

### 1. Environment Variables

Create a `.env` file in your project root with the following variables:

```env
# Shopify App Configuration
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SHOPIFY_APP_URL=https://your-app-domain.com
SCOPES=read_products,write_products,read_orders,write_orders,read_customers,write_customers,read_discounts,write_discounts,read_shipping,write_shipping

# OpenAI Configuration (Required for AI Chatbot)
OPENAI_API_KEY=your_openai_api_key

# Optional: Custom Shop Domain
SHOP_CUSTOM_DOMAIN=your-custom-domain.com

# Database (Prisma will use SQLite by default)
DATABASE_URL="file:./dev.sqlite"

# Session Secret (generate a random string)
SESSION_SECRET=your_session_secret_key_here
```

### 2. Get Your OpenAI API Key

1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new API key
3. Add it to your `.env` file as `OPENAI_API_KEY`

### 3. Install Dependencies & Start

```bash
npm install
npm run dev
```

## 🏪 Features

### Waiter-Style Service
- **No Popups**: Embedded iframe interface keeps customers on your site
- **Complete Service**: Handles browsing, recommendations, cart, and orders
- **Professional Assistance**: Like having a knowledgeable waiter for each customer

### AI-Powered Intelligence
- **Product Knowledge**: Learns from your entire product catalog
- **Smart Recommendations**: Suggests relevant products and bundles
- **Self-Training**: Improves from successful customer interactions

### Comprehensive Commerce
- **Cart Management**: Add, remove, update quantities
- **Discount Application**: Apply and validate discount codes
- **Shipping Calculations**: Real-time shipping rates and options
- **Order Creation**: Prepares orders for checkout

### Multi-Language Support
- **Auto-Detection**: Detects store language automatically
- **Global Ready**: Works with international stores

## 🛠️ Configuration

### Dashboard Features
- **Real-time Analytics**: Track chat sessions and customer interactions
- **Bot Configuration**: Customize AI behavior and responses
- **Knowledge Training**: Add specific product and business information
- **Embed Code**: Get iframe code for easy integration

### Integration Options

#### Hero Section Embed
```html
<iframe src="YOUR_APP_URL/chatbot?shop=YOUR_SHOP&theme=light&position=hero" 
        width="100%" height="600" frameborder="0">
</iframe>
```

#### Floating Chat Widget
```html
<iframe src="YOUR_APP_URL/chatbot?shop=YOUR_SHOP&theme=light&position=bottom-right" 
        width="350" height="500" frameborder="0">
</iframe>
```

## 🎨 Customization

### Themes
- `theme=light` - Light theme (default)
- `theme=dark` - Dark theme

### Positions
- `position=hero` - Full-width hero section
- `position=bottom-right` - Floating bottom-right
- `position=bottom-left` - Floating bottom-left
- `position=top-right` - Floating top-right
- `position=top-left` - Floating top-left

## 🧠 AI Training

The chatbot automatically learns from:
1. **Your entire website** - Products, descriptions, policies
2. **Customer interactions** - Successful conversations and patterns
3. **Manual training** - Knowledge you add through the dashboard

### Adding Custom Knowledge
1. Go to the "Training" tab in your dashboard
2. Add specific information about your products or policies
3. Choose appropriate categories for better organization

## 🔧 Technical Details

### Database Schema
- **Shop Configuration**: Store settings and preferences
- **Bot Configuration**: AI behavior and personality
- **Knowledge Base**: Custom training data
- **Chat Sessions**: Customer conversations and context
- **Chat Messages**: Individual messages and metadata

### API Endpoints
- `/api/chat` - Main chatbot conversation endpoint
- `/chatbot` - Iframe chatbot interface
- `/app` - Dashboard and configuration

### Shopify Integration
- **Products API**: Real-time product data and search
- **Orders API**: Order creation and management
- **Customers API**: Customer information and history
- **Discounts API**: Discount code validation and application
- **Shipping API**: Shipping rates and calculations

## 🚀 Deployment

### Shopify App Store
1. Configure your app in the Shopify Partner Dashboard
2. Set up your production environment variables
3. Deploy to your preferred hosting platform (Heroku, Vercel, etc.)
4. Submit for App Store review

### Custom Deployment
1. Set up your hosting environment
2. Configure environment variables
3. Run database migrations: `npx prisma migrate deploy`
4. Start the application: `npm start`

## 🆘 Support

### Common Issues

**"Bot not responding"**
- Check your OpenAI API key is valid
- Ensure you have API credits available
- Verify the bot is active in the configuration

**"Products not found"**
- Check Shopify API permissions include product read access
- Verify your store has products published
- Test the search functionality in the dashboard

**"Iframe not loading"**
- Ensure the shop parameter matches your Shopify domain
- Check CORS settings if embedding on external sites
- Verify the app URL is accessible

### Need Help?
- Check the dashboard for error logs
- Review the browser console for client-side issues
- Ensure all environment variables are properly set

## 🎯 Next Steps

1. **Test the Chatbot**: Use the preview link in your dashboard
2. **Train Your Bot**: Add specific product knowledge
3. **Customize Appearance**: Adjust themes and positioning
4. **Embed on Your Site**: Use the provided iframe code
5. **Monitor Performance**: Track analytics in the dashboard

Your AI waiter is ready to serve your customers! 🤖👨‍🍳
