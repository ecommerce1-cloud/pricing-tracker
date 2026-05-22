const { chromium } = require('playwright');

const NINJA_SEARCH_URL = 'https://ananinja.com/sa/en/product/search';

function extractEanFromMediaUrl(medias) {
  if (!medias || !Array.isArray(medias)) return null;
  for (const media of medias) {
    const url = media.url || '';
    // Match EAN in filenames like: 6291101711597.jpg, 6291101711375_1.png, 5056141857725___PY1.jpg
    const match = url.match(/\/(\d{8,14})[^/]*\.\w+$/);
    if (match) return match[1];
  }
  return null;
}

async function extractProductsFromPage(page) {
  return await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script'))
      .filter(s => s.textContent && s.textContent.includes('searchedProducts'));

    if (scripts.length === 0) return [];

    // Re-execute the __next_f.push() calls into a capture array
    // to properly decode the JavaScript string escaping
    const captured = [];
    const fakeSelf = {
      __next_f: {
        push(item) { captured.push(item); }
      }
    };

    for (const script of scripts) {
      try {
        const fn = new Function('self', script.textContent);
        fn(fakeSelf);
      } catch {}
    }

    // Reconstruct the full RSC payload from captured chunks
    let payload = '';
    for (const item of captured) {
      if (Array.isArray(item) && item[0] === 1 && typeof item[1] === 'string') {
        payload += item[1];
      }
    }

    // Find searchedProducts array in the decoded payload
    const marker = '"searchedProducts":';
    const idx = payload.indexOf(marker);
    if (idx === -1) return [];

    const arrStart = payload.indexOf('[', idx);
    if (arrStart === -1) return [];

    // String-aware bracket counter to find the matching ]
    let depth = 0;
    let inStr = false;
    let escaped = false;

    for (let i = arrStart; i < payload.length; i++) {
      const ch = payload[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (ch === '[') depth++;
        if (ch === ']') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(payload.substring(arrStart, i + 1));
            } catch {
              return [];
            }
          }
        }
      }
    }

    return [];
  });
}

async function scrapeNinja(barcodes, searchKeywords = []) {
  console.log(`[Ninja] Starting scrape for ${barcodes.length} barcodes...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const results = {};

  try {
    const page = await context.newPage();
    const allProductsByEan = new Map();

    // Step 1: Search by keywords to build product index
    // (Ninja does not support barcode/EAN search, so we search by brand keywords)
    const searchTerms = searchKeywords.length > 0 ? searchKeywords : ['hotpack'];
    console.log(`[Ninja] Searching by keywords: ${searchTerms.join(', ')}`);

    for (const term of searchTerms) {
      console.log(`[Ninja] Searching for: "${term}"`);
      try {
        await page.goto(`${NINJA_SEARCH_URL}?q=${term}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(5000);

        const products = await extractProductsFromPage(page);
        console.log(`[Ninja] Found ${products.length} products for "${term}"`);

        for (const product of products) {
          const ean = extractEanFromMediaUrl(product.medias);
          if (ean) {
            allProductsByEan.set(ean, product);
          }
        }
      } catch (err) {
        console.error(`[Ninja] Error searching "${term}": ${err.message}`);
      }
    }

    console.log(`[Ninja] Total products indexed by EAN: ${allProductsByEan.size}`);

    // Step 3: Match barcodes to products
    for (const barcode of barcodes) {
      const product = allProductsByEan.get(barcode);
      if (product) {
        const slug = (product.name || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');

        results[barcode] = {
          name: product.name || product.nameAr || 'Unknown',
          nameAr: product.nameAr || '',
          price: (product.priceCents || 0) / 100,
          originalPrice: (product.originalPriceCents || 0) / 100,
          discountedPrice: product.discountedPriceCents
            ? product.discountedPriceCents / 100
            : null,
          isAvailable: product.isAvailable || false,
          productId: product.productId || '',
          imageUrl: product.medias?.[0]?.url || '',
          url: `https://ananinja.com/sa/en/product/${slug}-${product.productId}`,
        };
        console.log(
          `[Ninja] MATCHED ${barcode}: ${product.name} - SAR ${results[barcode].price}`
        );
      } else {
        results[barcode] = {
          name: null,
          price: null,
          isAvailable: false,
          error: 'Product not found on Ninja',
        };
        console.log(`[Ninja] No match for barcode ${barcode}`);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { scrapeNinja };
