const fs = require('fs');
const path = require('path');
const { scrapeNinja } = require('./ninja');
const { scrapeAmazon } = require('./amazon');
const { scrapeHungerStation } = require('./hungerstation');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BARCODES_FILE = path.join(DATA_DIR, 'barcodes.json');
const PRICES_FILE = path.join(DATA_DIR, 'prices.json');

function loadConfig() {
  const raw = fs.readFileSync(BARCODES_FILE, 'utf-8');
  const data = JSON.parse(raw);
  return {
    barcodes: data.barcodes || [],
    searchKeywords: data.searchKeywords || [],
  };
}

function loadExistingPrices() {
  try {
    const raw = fs.readFileSync(PRICES_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { lastUpdated: null, products: [] };
  }
}

function mergePrices(existing, barcodes, ninjaResults, amazonResults, hungerStationResults) {
  const productMap = new Map();

  for (const product of existing.products) {
    productMap.set(product.barcode, product);
  }

  for (const barcode of barcodes) {
    const current = productMap.get(barcode) || { barcode };
    const ninja = ninjaResults[barcode];
    const amazon = amazonResults[barcode];

    // Ninja
    if (ninja && ninja.price !== null) {
      current.name = current.name || ninja.name;
      current.nameAr = ninja.nameAr || current.nameAr;
      current.imageUrl = ninja.imageUrl || current.imageUrl;
      current.ninja = {
        price: ninja.price,
        originalPrice: ninja.originalPrice,
        discountedPrice: ninja.discountedPrice,
        isAvailable: ninja.isAvailable,
        productId: ninja.productId,
        url: ninja.url,
        lastChecked: new Date().toISOString(),
      };
    } else if (ninja) {
      current.ninja = {
        price: null,
        isAvailable: false,
        error: ninja.error,
        lastChecked: new Date().toISOString(),
      };
    }

    // Amazon
    if (amazon && amazon.price !== null) {
      current.name = current.name || amazon.name;
      current.amazon = {
        price: amazon.price,
        asin: amazon.asin,
        url: amazon.url,
        isAvailable: amazon.isAvailable,
        lastChecked: new Date().toISOString(),
      };
    } else if (amazon) {
      current.amazon = {
        price: null,
        isAvailable: false,
        error: amazon.error,
        lastChecked: new Date().toISOString(),
      };
    }

    // HungerStation
    const hs = hungerStationResults[barcode];
    if (hs && hs.price !== null) {
      current.name = current.name || hs.name;
      current.hungerStation = {
        price: hs.price,
        originalPrice: hs.originalPrice,
        sku: hs.sku,
        hsId: hs.hsId,
        url: hs.url,
        isAvailable: hs.isAvailable,
        matchScore: hs.matchScore,
        lastChecked: new Date().toISOString(),
      };
    } else if (hs) {
      current.hungerStation = {
        price: null,
        isAvailable: false,
        error: hs.error,
        lastChecked: new Date().toISOString(),
      };
    }

    current.ninja = current.ninja || { price: null, lastChecked: null };
    current.amazon = current.amazon || { price: null, lastChecked: null };
    current.hungerStation = current.hungerStation || { price: null, lastChecked: null };

    productMap.set(barcode, current);
  }

  return {
    lastUpdated: new Date().toISOString(),
    products: Array.from(productMap.values()),
  };
}

async function main() {
  console.log('=== Pricing Tracker Scraper ===');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const config = loadConfig();
  const { barcodes, searchKeywords } = config;
  console.log(`Loaded ${barcodes.length} barcodes`);
  console.log(`Search keywords: ${searchKeywords.join(', ') || '(none)'}\n`);

  if (barcodes.length === 0) {
    console.log('No barcodes to track. Add barcodes to data/barcodes.json');
    return;
  }

  const existing = loadExistingPrices();

  const platform = process.argv.includes('--platform')
    ? process.argv[process.argv.indexOf('--platform') + 1]
    : 'all';

  let ninjaResults = {};
  if (platform === 'all' || platform === 'ninja') {
    ninjaResults = await scrapeNinja(barcodes, searchKeywords);
  }

  let amazonResults = {};
  if (platform === 'all' || platform === 'amazon') {
    amazonResults = await scrapeAmazon(barcodes);
  }

  // HungerStation uses name-based matching, so it needs existing product data
  let hungerStationResults = {};
  if (platform === 'all' || platform === 'hungerstation') {
    // Build product list from existing + fresh results for name matching
    const productNames = existing.products.slice();
    for (const barcode of barcodes) {
      const ninja = ninjaResults[barcode];
      const amazon = amazonResults[barcode];
      const name = (ninja && ninja.name) || (amazon && amazon.name);
      if (name) {
        productNames.push({ barcode, name });
      }
    }
    hungerStationResults = await scrapeHungerStation(barcodes, productNames);
  }

  const merged = mergePrices(existing, barcodes, ninjaResults, amazonResults, hungerStationResults);

  fs.writeFileSync(PRICES_FILE, JSON.stringify(merged, null, 2));
  console.log(`\nResults saved to ${PRICES_FILE}`);
  console.log(`Total products tracked: ${merged.products.length}`);
  console.log(`Last updated: ${merged.lastUpdated}`);
}

main().catch((err) => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
