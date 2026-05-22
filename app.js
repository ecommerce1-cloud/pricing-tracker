const PRICES_URL = 'data/prices.json';
const BARCODES_URL = 'data/barcodes.json';

let localBarcodes = JSON.parse(localStorage.getItem('trackedBarcodes') || '[]');
let pricesData = { lastUpdated: null, products: [] };

async function loadData() {
  try {
    const [pricesRes, barcodesRes] = await Promise.all([
      fetch(PRICES_URL).catch(() => null),
      fetch(BARCODES_URL).catch(() => null),
    ]);

    if (pricesRes && pricesRes.ok) {
      pricesData = await pricesRes.json();
    }

    if (barcodesRes && barcodesRes.ok) {
      const barcodesJson = await barcodesRes.json();
      const repoBarcodes = barcodesJson.barcodes || [];
      const merged = [...new Set([...repoBarcodes, ...localBarcodes])];
      localBarcodes = merged;
      localStorage.setItem('trackedBarcodes', JSON.stringify(localBarcodes));
    }
  } catch (err) {
    console.warn('Could not load remote data, using local state:', err);
  }

  renderTable();
  renderBarcodeChips();
  updateMeta();
}

function updateMeta() {
  const lastUpdatedEl = document.getElementById('lastUpdated');
  const productCountEl = document.getElementById('productCount');

  if (pricesData.lastUpdated) {
    const date = new Date(pricesData.lastUpdated);
    lastUpdatedEl.textContent = `Last updated: ${date.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })}`;
  } else {
    lastUpdatedEl.textContent = 'Last updated: No data yet';
  }

  const total = Math.max(localBarcodes.length, pricesData.products.length);
  productCountEl.textContent = `${total} product${total !== 1 ? 's' : ''}`;
}

function formatPrice(price) {
  if (price === null || price === undefined) return null;
  return parseFloat(price).toFixed(2);
}

function renderTable() {
  const tbody = document.getElementById('priceTableBody');
  const allBarcodes = [...new Set([
    ...localBarcodes,
    ...pricesData.products.map(p => p.barcode),
  ])];

  if (allBarcodes.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No barcodes tracked yet. Add a barcode above to get started.</td></tr>';
    return;
  }

  const productMap = new Map();
  for (const product of pricesData.products) {
    productMap.set(product.barcode, product);
  }

  tbody.innerHTML = allBarcodes.map(barcode => {
    const product = productMap.get(barcode) || {};
    const ninja = product.ninja || {};
    const amazon = product.amazon || {};
    const keeta = product.keeta || {};
    const hungerStation = product.hungerStation || {};

    const name = product.name || null;
    const ninjaPrice = formatPrice(ninja.price);
    const amazonPrice = formatPrice(amazon.price);
    const keetaPrice = formatPrice(keeta.price);
    const hsPrice = formatPrice(hungerStation.price);

    return `<tr>
      <td><span class="barcode-text">${barcode}</span></td>
      <td><span class="${name ? 'product-name' : 'product-name-unknown'}">${name || 'Pending...'}</span></td>
      <td class="price-cell">${renderPriceCell(ninjaPrice, ninja.url)}</td>
      <td class="price-cell">${renderPriceCell(amazonPrice, amazon.url)}</td>
      <td class="price-cell">${renderPriceCell(keetaPrice, keeta.url)}</td>
      <td class="price-cell">${renderPriceCell(hsPrice, hungerStation.url)}</td>
      <td style="text-align:center"><button class="btn-remove" onclick="removeBarcode('${barcode}')">Remove</button></td>
    </tr>`;
  }).join('');
}

function renderPriceCell(price, url) {
  if (price === null) {
    return '<span class="price-pending">--</span>';
  }
  const display = `SAR ${price}`;
  if (url) {
    return `<a href="${url}" target="_blank" rel="noopener" class="price-value" style="text-decoration:none">${display}</a>`;
  }
  return `<span class="price-value">${display}</span>`;
}

function addBarcode() {
  const input = document.getElementById('newBarcode');
  const barcode = input.value.trim();

  if (!barcode) return;
  if (!/^\d{8,14}$/.test(barcode)) {
    alert('Please enter a valid barcode (8-14 digits)');
    return;
  }
  if (localBarcodes.includes(barcode)) {
    alert('This barcode is already being tracked');
    return;
  }

  localBarcodes.push(barcode);
  localStorage.setItem('trackedBarcodes', JSON.stringify(localBarcodes));
  input.value = '';

  renderTable();
  renderBarcodeChips();
  updateMeta();
}

function removeBarcode(barcode) {
  localBarcodes = localBarcodes.filter(b => b !== barcode);
  localStorage.setItem('trackedBarcodes', JSON.stringify(localBarcodes));

  renderTable();
  renderBarcodeChips();
  updateMeta();
}

function renderBarcodeChips() {
  const container = document.getElementById('barcodeChips');
  if (localBarcodes.length === 0) {
    container.innerHTML = '<span style="color:#475569;font-size:13px">No barcodes tracked</span>';
    return;
  }
  container.innerHTML = localBarcodes.map(b =>
    `<span class="chip">${b}<span class="remove" onclick="removeBarcode('${b}')">&times;</span></span>`
  ).join('');
}

function exportCSV() {
  const allBarcodes = [...new Set([
    ...localBarcodes,
    ...pricesData.products.map(p => p.barcode),
  ])];

  const productMap = new Map();
  for (const product of pricesData.products) {
    productMap.set(product.barcode, product);
  }

  const rows = [['Barcode', 'Product Name', 'Ninja Price (SAR)', 'Amazon Price (SAR)', 'Keeta Price (SAR)', 'HungerStation Price (SAR)']];

  for (const barcode of allBarcodes) {
    const p = productMap.get(barcode) || {};
    rows.push([
      barcode,
      p.name || '',
      formatPrice(p.ninja?.price) || '',
      formatPrice(p.amazon?.price) || '',
      formatPrice(p.keeta?.price) || '',
      formatPrice(p.hungerStation?.price) || '',
    ]);
  }

  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pricing-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('newBarcode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBarcode();
});

loadData();
