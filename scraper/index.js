const fs = require('fs');
const path = require('path');
const { scrapeNinja } = require('./ninja');

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

function mergePrices(existing, barcodes, ninjaResults) {
  const productMap = new Map();

  for (const product of existing.products) {
    productMap.set(product.barcode, product);
  }

  for (const barcode of barcodes) {
    const current = productMap.get(barcode) || { barcode };
    const ninja = ninjaResults[barcode];

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

    current.amazon = current.amazon || { price: null, lastChecked: null };
    current.keeta = current.keeta || { price: null, lastChecked: null };
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
  console.log(`Loaded ${barcodes.length} barcodes: ${barcodes.join(', ')}`);
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

  const merged = mergePrices(existing, barcodes, ninjaResults);

  fs.writeFileSync(PRICES_FILE, JSON.stringify(merged, null, 2));
  console.log(`\nResults saved to ${PRICES_FILE}`);
  console.log(`Total products tracked: ${merged.products.length}`);
  console.log(`Last updated: ${merged.lastUpdated}`);
}

main().catch((err) => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
