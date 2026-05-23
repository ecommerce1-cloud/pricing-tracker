const { chromium } = require('playwright');

const VENDOR_ID = '6f2f8ff4-c375-49cb-8ea2-d1a8ed179900';
const HMARKET_URL = 'https://hungerstation.com/sa-en/qc/hmarket';

// Disposables & Papers subcategories (where Hotpack products live)
const CATEGORIES = [
  { name: 'Tissues', id: '2d9f651c-9793-4c62-8a17-5d3941a67882' },
  { name: 'Kitchen & Toilet Paper', id: '2a09344b-775c-4962-af16-165810e81168' },
  { name: 'Disposable Tableware', id: '50bf69c0-506b-4fbe-a29b-de1c977957b9' },
  { name: 'Garbage Bags', id: '6803c2b8-f3b0-4df3-8a7c-7e504f08dbd4' },
  { name: 'Food Storage & Wraps', id: 'a1f3a712-5a31-4373-b2c9-dfb253d74797' },
  { name: 'Gloves', id: '9385b8fe-acb2-42bf-bdca-73ffe42d0252' },
];

/**
 * Normalize a product name for fuzzy matching.
 */
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(pcs|pieces|piece|pack|packs|bags|bag|rolls|roll|sheets|sheet|cm|mm|m|kg|g|ml|l|oz|ft|sq|x|value|white|black|clear|blue|red|green)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well two product names match (0 to 1).
 */
function matchScore(nameA, nameB) {
  const a = normalize(nameA).split(' ').filter((w) => w.length >= 3);
  const b = normalize(nameB).split(' ').filter((w) => w.length >= 3);
  if (a.length === 0 || b.length === 0) return 0;

  // Brand must match (first significant word of the source name)
  const brandWords = ['hotpack', 'soft', 'cool', 'marjaan'];
  const sourceBrand = a.find((w) => brandWords.some((bw) => w.includes(bw)));
  if (sourceBrand) {
    const targetHasBrand = b.some((w) => brandWords.some((bw) => w.includes(bw) && sourceBrand.includes(bw)));
    if (!targetHasBrand) return 0; // brand mismatch = no match
  }

  let matches = 0;
  for (const word of a) {
    if (b.some((w) => w.includes(word) || word.includes(w))) {
      matches++;
    }
  }

  return a.length > 0 ? matches / a.length : 0;
}

async function scrapeHungerStation(barcodes, existingProducts) {
  console.log(`[HungerStation] Starting scrape for ${barcodes.length} barcodes...`);

  // Build a name lookup from existing product data (from Ninja/Amazon)
  const nameMap = new Map();
  for (const product of existingProducts) {
    if (product.barcode && product.name) {
      nameMap.set(product.barcode, product.name);
    }
  }
  console.log(`[HungerStation] Have names for ${nameMap.size} barcodes from other platforms`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const results = {};

  try {
    const page = await context.newPage();

    // Visit hmarket page to establish session/cookies
    console.log('[HungerStation] Loading hmarket page for session...');
    await page.goto(HMARKET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    // Fetch products from all categories using in-page fetch (has proper cookies)
    const allProducts = await page.evaluate(async (cats) => {
      const vendorId = '6f2f8ff4-c375-49cb-8ea2-d1a8ed179900';
      const all = [];

      for (const cat of cats) {
        try {
          const resp = await fetch(
            `/cw-api/category-products?vendorId=${vendorId}&isDarkstore=true&locale=en-SA&page=1&perPage=100&categoryId=${cat.id}`
          );
          const data = await resp.json();
          const items = data.items || [];
          all.push(...items.map((item) => ({
            name: item.name,
            price: item.price,
            originalPrice: item.originalPrice,
            sku: item.sku,
            id: item.id,
          })));
        } catch {}
      }

      return all;
    }, CATEGORIES);

    console.log(`[HungerStation] Total products fetched: ${allProducts.length}`);

    // Match barcodes to HungerStation products by name
    for (const barcode of barcodes) {
      const knownName = nameMap.get(barcode);
      if (!knownName) {
        results[barcode] = {
          name: null,
          price: null,
          isAvailable: false,
          error: 'No product name available for matching',
        };
        continue;
      }

      let bestMatch = null;
      let bestScore = 0;

      for (const hsProd of allProducts) {
        const score = matchScore(knownName, hsProd.name);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = hsProd;
        }
      }

      if (bestMatch && bestScore >= 0.5) {
        results[barcode] = {
          name: bestMatch.name,
          price: bestMatch.price,
          originalPrice: bestMatch.originalPrice || null,
          sku: bestMatch.sku,
          hsId: bestMatch.id,
          isAvailable: true,
          matchScore: Math.round(bestScore * 100),
          url: HMARKET_URL,
        };
        console.log(
          `[HungerStation] MATCHED ${barcode}: "${knownName}" -> "${bestMatch.name}" (${Math.round(bestScore * 100)}%) - SAR ${bestMatch.price}`
        );
      } else {
        results[barcode] = {
          name: null,
          price: null,
          isAvailable: false,
          error: bestMatch
            ? `Best match "${bestMatch.name}" too weak (${Math.round(bestScore * 100)}%)`
            : 'No matching product found',
        };
        console.log(`[HungerStation] No match for ${barcode} ("${knownName}")`);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { scrapeHungerStation };
