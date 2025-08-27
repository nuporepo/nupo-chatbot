import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Helper function to clean and process text content
function processContentForSearch(text) {
  if (!text) return "";
  
  // Remove HTML tags, normalize whitespace, convert to lowercase
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Extract keywords from text content
function extractKeywords(text, title = "") {
  if (!text && !title) return "";
  
  const combined = `${title} ${text}`.toLowerCase();
  
  // Simple keyword extraction - get important words
  const words = combined
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => 
      word.length > 3 && 
      !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'man', 'men', 'put', 'say', 'she', 'too', 'use'].includes(word)
    );
  
  // Get unique words and return as comma-separated string
  return [...new Set(words)].slice(0, 20).join(', ');
}

// Scrape all products from Shopify
async function scrapeProducts(admin, shopId) {
  console.log("🔍 Scraping all products...");
  console.log("🔍 Admin object:", typeof admin, Object.keys(admin || {}));
  
  const products = [];
  let hasNextPage = true;
  let cursor = null;
  
  while (hasNextPage) {
    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              title
              handle
              description
              descriptionHtml
              tags
              vendor
              productType
              createdAt
              updatedAt
              status
              images(first: 5) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    availableForSale
                    sku
                  }
                }
              }
              collections(first: 5) {
                edges {
                  node {
                    id
                    title
                    handle
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;
    
    const response = await admin.graphql(query, {
      variables: { first: 50, after: cursor }
    });
    
    console.log(`🔍 GraphQL Response Status: ${response.status}`);
    
    if (!response.ok) {
      console.error(`❌ GraphQL request failed:`, response.status, response.statusText);
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      console.error(`❌ GraphQL errors:`, data.errors);
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }
    
    if (data.data?.products?.edges) {
      for (const edge of data.data.products.edges) {
        const product = edge.node;
        
        // Build comprehensive searchable content
        const searchableContent = processContentForSearch([
          product.title,
          product.description,
          product.vendor,
          product.productType,
          product.tags?.join(' '),
          product.variants?.edges?.map(v => v.node.title).join(' '),
          product.collections?.edges?.map(c => c.node.title).join(' ')
        ].filter(Boolean).join(' '));
        
        const keywords = extractKeywords(
          `${product.description} ${product.tags?.join(' ')} ${product.vendor} ${product.productType}`,
          product.title
        );
        
        products.push({
          shopId,
          contentType: 'product',
          externalId: product.id,
          title: product.title,
          content: product.description || '',
          excerpt: product.description?.substring(0, 200) + '...' || '',
          url: `/products/${product.handle}`,
          tags: product.tags?.join(', ') || '',
          publishedAt: new Date(product.createdAt),
          searchableContent,
          keywords,
          lastScraped: new Date(),
          isActive: product.status === 'ACTIVE'
        });
      }
      
      hasNextPage = data.data.products.pageInfo.hasNextPage;
      cursor = data.data.products.pageInfo.endCursor;
    } else {
      hasNextPage = false;
    }
  }
  
  console.log(`✅ Found ${products.length} products`);
  return products;
}

// Scrape blog articles
async function scrapeBlogArticles(admin, shopId) {
  console.log("📰 Scraping blog articles...");
  
  const articles = [];
  
  // First get all blogs
  const blogsQuery = `
    query getBlogs($first: Int!) {
      blogs(first: $first) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  `;
  
  const blogsResponse = await admin.graphql(blogsQuery, {
    variables: { first: 10 }
  });
  
  const blogsData = await blogsResponse.json();
  
  if (blogsData.data?.blogs?.edges) {
    // For each blog, get all articles
    for (const blogEdge of blogsData.data.blogs.edges) {
      const blog = blogEdge.node;
      
      let hasNextPage = true;
      let cursor = null;
      
      while (hasNextPage) {
        const articlesQuery = `
          query getBlogArticles($blogId: ID!, $first: Int!, $after: String) {
            blog(id: $blogId) {
              articles(first: $first, after: $after) {
                edges {
                  cursor
                  node {
                    id
                    title
                    handle
                    contentHtml
                    excerpt
                    tags
                    createdAt
                    updatedAt
                    publishedAt
                    status
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        `;
        
        const articlesResponse = await admin.graphql(articlesQuery, {
          variables: { blogId: blog.id, first: 50, after: cursor }
        });
        
        const articlesData = await articlesResponse.json();
        
        if (articlesData.data?.blog?.articles?.edges) {
          for (const edge of articlesData.data.blog.articles.edges) {
            const article = edge.node;
            
            const searchableContent = processContentForSearch([
              article.title,
              article.contentHtml,
              article.excerpt,
              article.tags?.join(' ')
            ].filter(Boolean).join(' '));
            
            const keywords = extractKeywords(
              `${article.contentHtml} ${article.tags?.join(' ')}`,
              article.title
            );
            
            articles.push({
              shopId,
              contentType: 'article',
              externalId: article.id,
              title: article.title,
              content: article.contentHtml || '',
              excerpt: article.excerpt || article.contentHtml?.substring(0, 300) + '...' || '',
              url: `/blogs/${blog.handle}/${article.handle}`,
              tags: article.tags?.join(', ') || '',
              author: '',
              publishedAt: article.publishedAt ? new Date(article.publishedAt) : new Date(article.createdAt),
              searchableContent,
              keywords,
              lastScraped: new Date(),
              isActive: article.status === 'published'
            });
          }
          
          hasNextPage = articlesData.data.blog.articles.pageInfo.hasNextPage;
          cursor = articlesData.data.blog.articles.pageInfo.endCursor;
        } else {
          hasNextPage = false;
        }
      }
    }
  }
  
  console.log(`✅ Found ${articles.length} articles`);
  return articles;
}

// Scrape collections
async function scrapeCollections(admin, shopId) {
  console.log("📁 Scraping collections...");
  
  const collections = [];
  let hasNextPage = true;
  let cursor = null;
  
  while (hasNextPage) {
    const query = `
      query getCollections($first: Int!, $after: String) {
        collections(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              title
              handle
              description
              descriptionHtml
              updatedAt
              productsCount
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;
    
    const response = await admin.graphql(query, {
      variables: { first: 50, after: cursor }
    });
    
    console.log(`📁 Collections GraphQL Response Status: ${response.status}`);
    
    if (!response.ok) {
      console.error(`❌ Collections GraphQL request failed:`, response.status, response.statusText);
      throw new Error(`Collections GraphQL request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      console.error(`❌ Collections GraphQL errors:`, data.errors);
      throw new Error(`Collections GraphQL errors: ${JSON.stringify(data.errors)}`);
    }
    
    if (data.data?.collections?.edges) {
      for (const edge of data.data.collections.edges) {
        const collection = edge.node;
        
        const searchableContent = processContentForSearch([
          collection.title,
          collection.description
        ].filter(Boolean).join(' '));
        
        const keywords = extractKeywords(collection.description, collection.title);
        
        collections.push({
          shopId,
          contentType: 'collection',
          externalId: collection.id,
          title: collection.title,
          content: collection.description || '',
          excerpt: collection.description?.substring(0, 200) + '...' || '',
          url: `/collections/${collection.handle}`,
          tags: '',
          publishedAt: new Date(collection.updatedAt),
          searchableContent,
          keywords,
          lastScraped: new Date(),
          isActive: true
        });
      }
      
      hasNextPage = data.data.collections.pageInfo.hasNextPage;
      cursor = data.data.collections.pageInfo.endCursor;
    } else {
      hasNextPage = false;
    }
  }
  
  console.log(`✅ Found ${collections.length} collections`);
  return collections;
}

// Main scraping function
async function performFullScrape(admin, shopId, shopDomain) {
  console.log(`🚀 Starting full shop scrape for ${shopDomain}...`);
  
  try {
    // Create scraping job
    const job = await prisma.scrapingJob.create({
      data: {
        shopId,
        jobType: 'full_scrape',
        status: 'running',
        startedAt: new Date()
      }
    });
    
    let allContent = [];
    let totalItems = 0;
    
    // Scrape products
    await prisma.scrapingJob.update({
      where: { id: job.id },
      data: { progress: 10 }
    });
    
    const products = await scrapeProducts(admin, shopId);
    allContent = allContent.concat(products);
    totalItems += products.length;
    
    // Scrape articles (skip if no read_content scope)
    await prisma.scrapingJob.update({
      where: { id: job.id },
      data: { progress: 50 }
    });
    
    try {
      const articles = await scrapeBlogArticles(admin, shopId);
      allContent = allContent.concat(articles);
      totalItems += articles.length;
      console.log(`📰 Found ${articles.length} blog articles`);
    } catch (error) {
      if (error.message.includes("Access denied for blogs field")) {
        console.log("⚠️ Skipping blog articles - missing read_content scope");
      } else {
        throw error; // Re-throw if it's a different error
      }
    }
    
    // Scrape collections
    await prisma.scrapingJob.update({
      where: { id: job.id },
      data: { progress: 80 }
    });
    
    const collections = await scrapeCollections(admin, shopId);
    allContent = allContent.concat(collections);
    totalItems += collections.length;
    
    // Clear existing content and insert new
    await prisma.shopContent.deleteMany({
      where: { shopId }
    });
    
    // Insert in batches to avoid memory issues
    const batchSize = 100;
    let processed = 0;
    
    for (let i = 0; i < allContent.length; i += batchSize) {
      const batch = allContent.slice(i, i + batchSize);
      await prisma.shopContent.createMany({
        data: batch,
        skipDuplicates: true
      });
      processed += batch.length;
      
      // Update progress
      const progress = Math.min(90 + Math.floor((processed / allContent.length) * 10), 100);
      await prisma.scrapingJob.update({
        where: { id: job.id },
        data: { 
          progress,
          itemsProcessed: processed
        }
      });
    }
    
    // Complete the job
    await prisma.scrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        itemsFound: totalItems,
        itemsProcessed: processed,
        completedAt: new Date()
      }
    });
    
    console.log(`✅ Scraping completed! Processed ${processed} items`);
    return { success: true, itemsProcessed: processed, jobId: job.id };
    
  } catch (error) {
    console.error("❌ Scraping failed:", error);
    
    // Update job with error
    try {
      await prisma.scrapingJob.updateMany({
        where: { shopId, status: 'running' },
        data: {
          status: 'failed',
          errorMessage: error.message,
          completedAt: new Date()
        }
      });
    } catch (updateError) {
      console.error("Failed to update job status:", updateError);
    }
    
    throw error;
  }
}

export const action = async ({ request }) => {
  console.log("🔐 Scraping API: Starting authentication...");
  
  const { admin, session } = await authenticate.admin(request);
  
  console.log("🔐 Session details:", {
    shop: session?.shop,
    accessToken: session?.accessToken ? "present" : "missing",
    isOnline: session?.isOnline,
    scope: session?.scope
  });
  
  if (!session?.shop) {
    console.error("❌ No shop in session!");
    return json({ error: "No valid shop session found" }, { status: 401 });
  }
  
  const formData = await request.formData();
  const action = formData.get("action");
  
  console.log(`🎯 Action: ${action} for shop: ${session.shop}`);
  
  // Get shop
  let shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { scrapingJobs: { orderBy: { createdAt: 'desc' }, take: 5 } }
  });
  
  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }
  
  try {
    switch (action) {
      case "start_scrape":
        // Check if there's already a running job
        const runningJob = await prisma.scrapingJob.findFirst({
          where: { 
            shopId: shop.id,
            status: 'running'
          }
        });
        
        if (runningJob) {
          return json({ error: "A scraping job is already running" }, { status: 400 });
        }
        
        // Start scraping immediately with current admin session
        try {
          const result = await performFullScrape(admin, shop.id, session.shop);
          return json({ 
            success: true, 
            message: "Scraping completed successfully!",
            result
          });
        } catch (scrapeError) {
          console.error("Scraping failed:", scrapeError);
          return json({ 
            error: `Scraping failed: ${scrapeError.message}` 
          }, { status: 500 });
        }
        
      case "get_status":
        const latestJob = await prisma.scrapingJob.findFirst({
          where: { shopId: shop.id },
          orderBy: { createdAt: 'desc' }
        });
        
        const contentStats = await prisma.shopContent.groupBy({
          by: ['contentType'],
          where: { shopId: shop.id },
          _count: { id: true }
        });
        
        return json({
          latestJob,
          contentStats: contentStats.reduce((acc, stat) => {
            acc[stat.contentType] = stat._count.id;
            return acc;
          }, {})
        });
        
      default:
        return json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Scraping API error:", error);
    return json({ error: error.message }, { status: 500 });
  }
};
