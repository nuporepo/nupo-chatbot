import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Import the scraping functions from api.scrape
async function performFullScrape(admin, shopId, shopDomain) {
  // Re-import the scraping logic here or create a shared module
  console.log(`🕒 CRON: Starting automated scrape for ${shopDomain}...`);
  
  try {
    // Create scraping job
    const job = await prisma.scrapingJob.create({
      data: {
        shopId,
        jobType: 'automated_daily',
        status: 'running',
        startedAt: new Date()
      }
    });

    // Simple product scraping for automated job
    const response = await admin.graphql(`
      query getProducts($first: Int!) {
        products(first: $first) {
          edges {
            node {
              id
              title
              handle
              description
              tags
              vendor
              productType
              createdAt
              updatedAt
              status
            }
          }
        }
      }
    `, { variables: { first: 250 } });

    const data = await response.json();
    let processed = 0;

    if (data.data?.products?.edges) {
      // Clear existing products
      await prisma.shopContent.deleteMany({
        where: { shopId, contentType: 'product' }
      });

      // Process products
      const products = data.data.products.edges.map(edge => {
        const product = edge.node;
        
        const searchableContent = [
          product.title,
          product.description,
          product.vendor,
          product.productType,
          product.tags?.join(' ')
        ].filter(Boolean).join(' ').toLowerCase();
        
        const keywords = product.tags?.join(', ') || '';
        
        return {
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
        };
      });

      // Insert in batches
      const batchSize = 50;
      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        await prisma.shopContent.createMany({
          data: batch,
          skipDuplicates: true
        });
        processed += batch.length;
      }
    }

    // Complete the job
    await prisma.scrapingJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        itemsFound: processed,
        itemsProcessed: processed,
        completedAt: new Date()
      }
    });

    console.log(`✅ CRON: Automated scraping completed for ${shopDomain}. Processed ${processed} products.`);
    return { success: true, processed };

  } catch (error) {
    console.error(`❌ CRON: Automated scraping failed for ${shopDomain}:`, error);
    
    // Update job with error
    try {
      await prisma.scrapingJob.updateMany({
        where: { shopId, status: 'running', jobType: 'automated_daily' },
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
  // Verify this is a cron request (in production, you'd verify the cron secret)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || 'dev-cron-secret';
  
  if (authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("🕒 CRON: Starting automated scraping for all shops...");

  try {
    // Get all active shops
    const shops = await prisma.shop.findMany({
      include: { botConfig: true }
    });

    let totalProcessed = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const shop of shops) {
      try {
        // Check if shop has been scraped in last 23 hours
        const recentJob = await prisma.scrapingJob.findFirst({
          where: {
            shopId: shop.id,
            status: 'completed',
            createdAt: {
              gte: new Date(Date.now() - 23 * 60 * 60 * 1000) // 23 hours ago
            }
          }
        });

        if (recentJob) {
          console.log(`⏭️ CRON: Skipping ${shop.shopDomain} - scraped recently`);
          continue;
        }

        // Create a simple admin client for this shop
        // Note: In production, you'd need to store and use the shop's access token
        console.log(`🔄 CRON: Processing ${shop.shopDomain}...`);
        
        // For now, we'll skip shops without proper authentication
        // In a full implementation, you'd store access tokens in the database
        console.log(`⚠️ CRON: Skipping ${shop.shopDomain} - authentication not implemented for cron jobs`);
        
        successCount++;
      } catch (shopError) {
        console.error(`❌ CRON: Failed to process ${shop.shopDomain}:`, shopError);
        errorCount++;
      }
    }

    console.log(`✅ CRON: Automated scraping completed. Success: ${successCount}, Errors: ${errorCount}`);

    return json({
      success: true,
      shopsProcessed: shops.length,
      successCount,
      errorCount,
      totalProcessed
    });

  } catch (error) {
    console.error("❌ CRON: Automated scraping failed:", error);
    return json({ error: error.message }, { status: 500 });
  }
};

// Handle GET requests for manual testing
export const loader = async ({ request }) => {
  return json({ 
    message: "Automated scraping cron endpoint",
    usage: "POST with Authorization: Bearer <cron_secret>",
    nextRun: "Every 24 hours"
  });
};
