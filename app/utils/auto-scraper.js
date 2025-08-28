// Internal auto-scraping utility
// Runs automatically when users interact with the chatbot after 24 hours

import prisma from "../db.server";

// Check if shop needs scraping (last scrape > 24 hours ago)
export async function shouldAutoScrape(shopId) {
  try {
    const lastSuccessfulScrape = await prisma.scrapingJob.findFirst({
      where: {
        shopId,
        status: 'completed'
      },
      orderBy: { completedAt: 'desc' }
    });

    if (!lastSuccessfulScrape) {
      console.log(`📊 Shop ${shopId}: No previous scraping found - needs initial scrape`);
      return true;
    }

    const hoursSinceLastScrape = (Date.now() - new Date(lastSuccessfulScrape.completedAt).getTime()) / (1000 * 60 * 60);
    const needsScraping = hoursSinceLastScrape >= 24;
    
    console.log(`📊 Shop ${shopId}: Last scraped ${Math.round(hoursSinceLastScrape)} hours ago - ${needsScraping ? 'needs' : 'does not need'} scraping`);
    
    return needsScraping;
  } catch (error) {
    console.error("Error checking scrape status:", error);
    return false; // Don't scrape if we can't check
  }
}

// Trigger background scraping for a shop
export async function triggerAutoScrape(admin, shopId, shopDomain) {
  try {
    console.log(`🤖 AUTO-SCRAPE: Starting background scraping for ${shopDomain}`);
    
    // Check if there's already a running job
    const runningJob = await prisma.scrapingJob.findFirst({
      where: { 
        shopId,
        status: 'running'
      }
    });
    
    if (runningJob) {
      console.log(`⏭️ AUTO-SCRAPE: Skipping ${shopDomain} - job already running`);
      return false;
    }

    // Create job
    const job = await prisma.scrapingJob.create({
      data: {
        shopId,
        jobType: 'auto_24h',
        status: 'running',
        startedAt: new Date()
      }
    });

    // Start scraping in background (don't await - let it run async)
    performBackgroundScrape(admin, shopId, shopDomain, job.id).catch(error => {
      console.error(`❌ AUTO-SCRAPE: Background scraping failed for ${shopDomain}:`, error);
      
      // Update job with error
      prisma.scrapingJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorMessage: error.message,
          completedAt: new Date()
        }
      }).catch(updateError => {
        console.error("Failed to update job status:", updateError);
      });
    });

    console.log(`✅ AUTO-SCRAPE: Background scraping started for ${shopDomain}`);
    return true;
  } catch (error) {
    console.error(`❌ AUTO-SCRAPE: Failed to trigger scraping for ${shopDomain}:`, error);
    return false;
  }
}

// Background scraping function (simplified version)
async function performBackgroundScrape(admin, shopId, shopDomain, jobId) {
  console.log(`🔄 AUTO-SCRAPE: Processing ${shopDomain} in background...`);
  
  try {
    let totalProcessed = 0;

    // Update progress
    await prisma.scrapingJob.update({
      where: { id: jobId },
      data: { progress: 10 }
    });

    // Simple product scraping
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
              variants(first: 5) {
                edges {
                  node {
                    availableForSale
                  }
                }
              }
            }
          }
        }
      }
    `, { variables: { first: 250 } });

    const data = await response.json();
    
    await prisma.scrapingJob.update({
      where: { id: jobId },
      data: { progress: 50 }
    });

    if (data.data?.products?.edges) {
      // Clear existing products (OVERRIDE old data)
      await prisma.shopContent.deleteMany({
        where: { shopId, contentType: 'product' }
      });

      // Process products
      const products = data.data.products.edges
        .filter(edge => {
          // Only include products that have at least one available variant
          const hasAvailableVariant = edge.node.variants.edges.some(v => v.node.availableForSale);
          return hasAvailableVariant;
        })
        .map(edge => {
          const product = edge.node;
          
          const searchableContent = [
            product.title,
            product.description,
            product.vendor,
            product.productType,
            product.tags?.join(' ')
          ].filter(Boolean).join(' ').toLowerCase();
          
          const keywords = [
            product.title,
            ...(product.tags || []),
            product.vendor,
            product.productType
          ].filter(Boolean).join(', ');
          
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
        totalProcessed += batch.length;
        
        // Update progress
        const progress = Math.min(70 + Math.floor((i / products.length) * 20), 90);
        await prisma.scrapingJob.update({
          where: { id: jobId },
          data: { 
            progress,
            itemsProcessed: totalProcessed
          }
        });
      }
    }

    // Complete the job
    await prisma.scrapingJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        progress: 100,
        itemsFound: totalProcessed,
        itemsProcessed: totalProcessed,
        completedAt: new Date()
      }
    });

    console.log(`✅ AUTO-SCRAPE: Completed for ${shopDomain}. Processed ${totalProcessed} products (OVERRODE old data)`);
    return totalProcessed;

  } catch (error) {
    console.error(`❌ AUTO-SCRAPE: Failed for ${shopDomain}:`, error);
    throw error;
  }
}
