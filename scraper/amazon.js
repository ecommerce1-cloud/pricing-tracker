const { chromium } = require('playwright');

const AMAZON_SEARCH_URL = 'https://www.amazon.sa/s';

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function scrapeAmazon(barcodes) {
  console.log(`[Amazon] Starting scrape for ${barcodes.length} barcodes...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-AE',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
    },
  });

  const results = {};

  try {
    const page = await context.newPage();

    // Visit homepage first to get cookies
    console.log('[Amazon] Loading homepage for cookies...');
    await page.goto('https://www.amazon.sa/?language=en_AE', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    for (let i = 0; i < barcodes.length; i++) {
      const barcode = barcodes[i];
      console.log(`[Amazon] (${i + 1}/${barcodes.length}) Searching: ${barcode}`);

      try {
        await page.goto(`${AMAZON_SEARCH_URL}?k=${barcode}&language=en_AE`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(randomDelay(2000, 4000));

        // Check for CAPTCHA
        const isCaptcha = await page.evaluate(() => {
          return (
            document.title.includes('Robot') ||
            document.title.includes('Sorry') ||
            !!document.querySelector('#captchacharacters') ||
            document.body.innerText.includes("we just need to make sure you're not a robot")
          );
        });

        if (isCaptcha) {
          console.log(`[Amazon] CAPTCHA detected. Waiting and retrying...`);
          await page.waitForTimeout(10000);
          await page.goto(`${AMAZON_SEARCH_URL}?k=${barcode}&language=en_AE`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          await page.waitForTimeout(5000);
        }

        const productData = await page.evaluate(() => {
          // Find the first search result with a price
          const items = document.querySelectorAll('[data-component-type="s-search-result"]');

          for (const item of items) {
            const asin = item.getAttribute('data-asin');
            if (!asin) continue;

            // Get title
            const titleEl = item.querySelector('h2 a span, h2 span');
            const title = titleEl ? titleEl.textContent.trim() : null;

            // Get price - try multiple selectors
            let price = null;
            const priceWhole = item.querySelector('.a-price .a-price-whole');
            const priceFraction = item.querySelector('.a-price .a-price-fraction');
            if (priceWhole) {
              const whole = priceWhole.textContent.replace(/[^0-9]/g, '');
              const fraction = priceFraction
                ? priceFraction.textContent.replace(/[^0-9]/g, '')
                : '00';
              price = parseFloat(`${whole}.${fraction}`);
            }

            // Fallback: try .a-offscreen price
            if (!price) {
              const offscreen = item.querySelector('.a-price .a-offscreen');
              if (offscreen) {
                const match = offscreen.textContent.match(/([\d,]+\.?\d*)/);
                if (match) price = parseFloat(match[1].replace(/,/g, ''));
              }
            }

            // Get product URL
            const linkEl = item.querySelector('h2 a');
            const href = linkEl ? linkEl.getAttribute('href') : null;

            if (title) {
              const productUrl = asin
                ? `https://www.amazon.sa/dp/${asin}`
                : href
                ? `https://www.amazon.sa${href.split('?')[0]}`
                : null;
              return { asin, title, price, url: productUrl };
            }
          }

          // No search results with component type - try simpler approach
          const noResults = document.body.innerText.includes('No results for') ||
            document.body.innerText.includes('did not match any products');

          return noResults ? { noResults: true } : null;
        });

        if (productData && !productData.noResults && productData.title) {
          results[barcode] = {
            name: productData.title,
            price: productData.price,
            asin: productData.asin,
            url: productData.url,
            isAvailable: productData.price !== null,
          };
          console.log(
            `[Amazon] MATCHED ${barcode}: ${productData.title} - ${
              productData.price ? `SAR ${productData.price}` : 'No price'
            }`
          );
        } else {
          results[barcode] = {
            name: null,
            price: null,
            isAvailable: false,
            error: 'Product not found on Amazon.sa',
          };
          console.log(`[Amazon] No match for ${barcode}`);
        }
      } catch (err) {
        console.error(`[Amazon] Error for ${barcode}: ${err.message}`);
        results[barcode] = {
          name: null,
          price: null,
          isAvailable: false,
          error: err.message,
        };
      }

      // Delay between requests to avoid blocks
      if (i < barcodes.length - 1) {
        await page.waitForTimeout(randomDelay(2000, 5000));
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { scrapeAmazon };
