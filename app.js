const PRICES_URL = 'data/prices.json';
const BARCODES_URL = 'data/barcodes.json';

const PLATFORM_LOGOS = {
  Ninja: 'https://www.google.com/s2/favicons?domain=ananinja.com&sz=16',
  Amazon: 'https://www.google.com/s2/favicons?domain=amazon.sa&sz=16',
  HungerStation: 'https://www.google.com/s2/favicons?domain=hungerstation.com&sz=16',
};

let localBarcodes = JSON.parse(localStorage.getItem('trackedBarcodes') || '[]');
let repoBarcodes = []; // barcodes from the actual repo file
let pricesData = { lastUpdated: null, products: [] };
let currentSort = { key: null, dir: 'asc' };
let currentPage = 1;
const PAGE_SIZE = 25;

// ── Data Loading ──
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
      repoBarcodes = barcodesJson.barcodes || [];
      const merged = [...new Set([...repoBarcodes, ...localBarcodes])];
      localBarcodes = merged;
      localStorage.setItem('trackedBarcodes', JSON.stringify(localBarcodes));
    }
  } catch (err) {
    console.warn('Could not load remote data:', err);
  }

  renderAll();
}

function renderAll() {
  updateStats();
  renderCharts();
  renderTable();
  renderBarcodeChips();
}

// ── Helpers ──
function formatPrice(price) {
  if (price === null || price === undefined) return null;
  return parseFloat(price).toFixed(2);
}

function getProductList() {
  const allBarcodes = [...new Set([
    ...localBarcodes,
    ...pricesData.products.map(p => p.barcode),
  ])];

  const productMap = new Map();
  for (const product of pricesData.products) {
    productMap.set(product.barcode, product);
  }

  return allBarcodes.map(barcode => {
    const p = productMap.get(barcode) || {};
    const ninja = p.ninja || {};
    const amazon = p.amazon || {};
    const hs = p.hungerStation || {};

    const prices = [
      { platform: 'Ninja', price: ninja.price, url: ninja.url },
      { platform: 'Amazon', price: amazon.price, url: amazon.url },
      { platform: 'HungerStation', price: hs.price, url: hs.url },
    ].filter(x => x.price != null);

    const best = prices.length > 0
      ? prices.reduce((a, b) => a.price <= b.price ? a : b)
      : null;

    return {
      barcode,
      name: p.name || null,
      ninja: ninja.price,
      ninjaUrl: ninja.url,
      amazon: amazon.price,
      amazonUrl: amazon.url,
      hungerstation: hs.price,
      hungerstationUrl: hs.url,
      bestPlatform: best ? best.platform : null,
      bestPrice: best ? best.price : null,
      priceCount: prices.length,
    };
  });
}

// ── Stats Cards ──
function updateStats() {
  const products = getProductList();
  const total = products.length;

  // Total
  document.getElementById('statTotal').textContent = total;

  // Average price across all platforms
  const allPrices = [];
  products.forEach(p => {
    if (p.ninja) allPrices.push(p.ninja);
    if (p.amazon) allPrices.push(p.amazon);
    if (p.hungerstation) allPrices.push(p.hungerstation);
  });
  const avg = allPrices.length > 0
    ? (allPrices.reduce((s, v) => s + v, 0) / allPrices.length).toFixed(1)
    : '--';
  document.getElementById('statAvgPrice').textContent = avg;

  // Cheapest platform (most wins)
  const wins = { Ninja: 0, Amazon: 0, HungerStation: 0 };
  products.forEach(p => {
    if (p.bestPlatform) wins[p.bestPlatform]++;
  });
  const cheapest = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
  const cheapestEl = document.getElementById('statCheapest');
  if (cheapest[1] > 0) {
    const logo = PLATFORM_LOGOS[cheapest[0]] || '';
    cheapestEl.innerHTML = `<img src="${logo}" alt="" class="stat-logo">${cheapest[0]}`;
  } else {
    cheapestEl.textContent = '--';
  }

  // Last updated
  if (pricesData.lastUpdated) {
    const d = new Date(pricesData.lastUpdated);
    document.getElementById('statUpdated').textContent = d.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }
}

// ── Charts ──
let chartInstances = {};

function renderCharts() {
  const products = getProductList();

  // Coverage chart (bar)
  const ninjaCov = products.filter(p => p.ninja != null).length;
  const amazonCov = products.filter(p => p.amazon != null).length;
  const hsCov = products.filter(p => p.hungerstation != null).length;

  const platformLabels = ['Ninja', 'Amazon', 'HungerStation'];

  renderBarChart('coverageChart', {
    labels: platformLabels,
    data: [ninjaCov, amazonCov, hsCov],
    colors: ['#f59e0b', '#3b82f6', '#ec4899'],
    max: products.length,
  });

  // Avg price chart (bar)
  const ninjaP = products.filter(p => p.ninja != null).map(p => p.ninja);
  const amazonP = products.filter(p => p.amazon != null).map(p => p.amazon);
  const hsP = products.filter(p => p.hungerstation != null).map(p => p.hungerstation);
  const avgN = ninjaP.length ? (ninjaP.reduce((a, b) => a + b, 0) / ninjaP.length) : 0;
  const avgA = amazonP.length ? (amazonP.reduce((a, b) => a + b, 0) / amazonP.length) : 0;
  const avgH = hsP.length ? (hsP.reduce((a, b) => a + b, 0) / hsP.length) : 0;

  renderBarChart('avgPriceChart', {
    labels: platformLabels,
    data: [avgN.toFixed(1), avgA.toFixed(1), avgH.toFixed(1)],
    colors: ['#f59e0b', '#3b82f6', '#ec4899'],
  });

  // Best price distribution (doughnut)
  const wins = { Ninja: 0, Amazon: 0, HungerStation: 0 };
  products.forEach(p => { if (p.bestPlatform) wins[p.bestPlatform]++; });

  renderDoughnutChart('bestPriceChart', {
    labels: ['Ninja', 'Amazon', 'HungerStation'],
    data: [wins.Ninja, wins.Amazon, wins.HungerStation],
    colors: ['#f59e0b', '#3b82f6', '#ec4899'],
  });
}

function renderBarChart(canvasId, { labels, data, colors, max }) {
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  const ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderRadius: 6,
        barThickness: 40,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2937',
          titleFont: { size: 12 },
          bodyFont: { size: 12 },
          padding: 10,
          cornerRadius: 8,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: max || undefined,
          grid: { color: '#f3f4f6' },
          ticks: { font: { size: 11 }, color: '#9ca3af' },
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, weight: 600 }, color: '#6b7280' },
        },
      },
    },
  });
}

function renderDoughnutChart(canvasId, { labels, data, colors }) {
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');

  // Preload logo images for legend
  const logoImages = {};
  labels.forEach(label => {
    const img = new Image();
    img.src = PLATFORM_LOGOS[label] || '';
    logoImages[label] = img;
  });

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        spacing: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: '#1f2937',
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed} products`,
          },
        },
      },
    },
  });

  // Custom HTML legend with logos
  let legendContainer = canvas.parentElement.querySelector('.custom-legend');
  if (!legendContainer) {
    legendContainer = document.createElement('div');
    legendContainer.className = 'custom-legend';
    canvas.parentElement.appendChild(legendContainer);
  }
  legendContainer.innerHTML = labels.map((label, i) =>
    `<span class="legend-item">
      <span class="legend-dot" style="background:${colors[i]}"></span>
      <img src="${PLATFORM_LOGOS[label]}" alt="" class="legend-logo">
      ${label} <span class="legend-count">${data[i]}</span>
    </span>`
  ).join('');
}

// ── Table Rendering ──
function getFilteredProducts() {
  let products = getProductList();

  // Search filter
  const search = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  if (search) {
    products = products.filter(p =>
      p.barcode.includes(search) ||
      (p.name && p.name.toLowerCase().includes(search))
    );
  }

  // Platform filter
  const filter = document.getElementById('filterPlatform').value;
  switch (filter) {
    case 'has-all':
      products = products.filter(p => p.ninja != null && p.amazon != null && p.hungerstation != null);
      break;
    case 'ninja-only':
      products = products.filter(p => p.ninja != null);
      break;
    case 'amazon-only':
      products = products.filter(p => p.amazon != null);
      break;
    case 'hs-only':
      products = products.filter(p => p.hungerstation != null);
      break;
    case 'cheapest-ninja':
      products = products.filter(p => p.bestPlatform === 'Ninja');
      break;
    case 'cheapest-amazon':
      products = products.filter(p => p.bestPlatform === 'Amazon');
      break;
    case 'cheapest-hs':
      products = products.filter(p => p.bestPlatform === 'HungerStation');
      break;
  }

  // Sort
  if (currentSort.key) {
    products.sort((a, b) => {
      let va = a[currentSort.key];
      let vb = b[currentSort.key];
      if (va == null) va = currentSort.dir === 'asc' ? Infinity : -Infinity;
      if (vb == null) vb = currentSort.dir === 'asc' ? Infinity : -Infinity;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return currentSort.dir === 'asc' ? -1 : 1;
      if (va > vb) return currentSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  return products;
}

function renderTable() {
  const filtered = getFilteredProducts();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('priceTableBody');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No products match your filter.</td></tr>';
  } else {
    tbody.innerHTML = page.map(p => {
      const prices = [
        { key: 'ninja', val: p.ninja },
        { key: 'amazon', val: p.amazon },
        { key: 'hungerstation', val: p.hungerstation },
      ].filter(x => x.val != null);

      const lowest = prices.length > 0
        ? Math.min(...prices.map(x => x.val))
        : null;
      const highest = prices.length > 1
        ? Math.max(...prices.map(x => x.val))
        : null;

      const inRepo = repoBarcodes.includes(p.barcode);
      const repoTag = inRepo ? '' : '<span class="not-in-scraper" title="This barcode is not in barcodes.json yet. Add it to the repo for the scraper to pick it up.">Not in scraper</span>';

      return `<tr>
        <td><span class="barcode-text">${p.barcode}</span> ${repoTag}</td>
        <td><span class="${p.name ? 'product-name' : 'product-name-unknown'}">${p.name || 'Pending...'}</span></td>
        <td class="price-cell">${renderPriceCell(p.ninja, p.ninjaUrl, p.ninja === lowest, p.ninja === highest && prices.length > 1)}</td>
        <td class="price-cell">${renderPriceCell(p.amazon, p.amazonUrl, p.amazon === lowest, p.amazon === highest && prices.length > 1)}</td>
        <td class="price-cell">${renderPriceCell(p.hungerstation, p.hungerstationUrl, p.hungerstation === lowest, p.hungerstation === highest && prices.length > 1)}</td>
        <td class="price-cell">${renderBestTag(p.bestPlatform, p.bestPrice)}</td>
        <td style="text-align:center"><button class="btn-remove" onclick="removeBarcode('${p.barcode}')">Remove</button></td>
      </tr>`;
    }).join('');
  }

  // Update footer
  document.getElementById('tableInfo').textContent =
    `Showing ${start + 1}-${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} products`;

  renderPagination(totalPages);
  updateSortHeaders();
}

function renderPriceCell(price, url, isLowest, isHighest) {
  if (price == null) return '<span class="price-pending">--</span>';
  const formatted = `SAR ${parseFloat(price).toFixed(2)}`;
  const cls = isLowest ? 'price-value price-lowest' : isHighest ? 'price-value price-highest' : 'price-value';
  if (url) {
    return `<a href="${url}" target="_blank" rel="noopener" class="${cls}">${formatted}</a>`;
  }
  return `<span class="${cls}">${formatted}</span>`;
}

function renderBestTag(platform, price) {
  if (!platform) return '<span class="best-price-tag none">N/A</span>';
  const cls = platform === 'Ninja' ? 'ninja' : platform === 'Amazon' ? 'amazon' : 'hungerstation';
  const logo = PLATFORM_LOGOS[platform] || '';
  return `<span class="best-price-tag ${cls}"><img src="${logo}" alt="" class="tag-logo">${platform} SAR ${parseFloat(price).toFixed(2)}</span>`;
}

function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '';
  if (currentPage > 1) {
    html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})">&laquo;</button>`;
  }

  const range = [];
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
    range.push(i);
  }
  if (range[0] > 1) html += `<button class="page-btn" onclick="goToPage(1)">1</button><span style="color:#9ca3af;padding:0 4px">...</span>`;

  for (const p of range) {
    html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
  }

  if (range[range.length - 1] < totalPages) html += `<span style="color:#9ca3af;padding:0 4px">...</span><button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;

  if (currentPage < totalPages) {
    html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})">&raquo;</button>`;
  }

  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderTable();
}

// ── Sorting ──
function sortTable(key) {
  if (currentSort.key === key) {
    currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.key = key;
    currentSort.dir = 'asc';
  }
  currentPage = 1;
  renderTable();
}

function updateSortHeaders() {
  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
  });
  if (currentSort.key) {
    const idx = ['barcode', 'name', 'ninja', 'amazon', 'hungerstation'].indexOf(currentSort.key);
    if (idx >= 0) {
      const th = document.querySelectorAll('thead th')[idx];
      th.classList.add(currentSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  }
}

// ── Filtering ──
function filterTable() {
  currentPage = 1;
  renderTable();
}

// ── Barcode Management ──
async function addBarcode() {
  const input = document.getElementById('newBarcode');
  const barcode = input.value.trim();

  if (!barcode) return;
  if (!/^\d{8,14}$/.test(barcode)) {
    showToast('Please enter a valid barcode (8-14 digits)', 'error');
    return;
  }
  if (localBarcodes.includes(barcode)) {
    showToast('This barcode is already being tracked', 'error');
    return;
  }

  localBarcodes.push(barcode);
  localStorage.setItem('trackedBarcodes', JSON.stringify(localBarcodes));
  input.value = '';
  renderAll();

  // Auto-sync to GitHub if connected
  if (isGitHubConnected()) {
    showToast('Syncing barcode to GitHub...', 'success');
    const ok = await syncBarcodesToGitHub();
    if (ok) {
      showToast(`Barcode ${barcode} added and synced to GitHub! Triggering scraper...`, 'success');
      renderAll(); // re-render to remove "not in scraper" badge
      await triggerScraper();
    } else {
      showToast('Barcode added locally but GitHub sync failed. Check your settings.', 'error');
    }
  }
}

async function removeBarcode(barcode) {
  localBarcodes = localBarcodes.filter(b => b !== barcode);
  localStorage.setItem('trackedBarcodes', JSON.stringify(localBarcodes));
  renderAll();

  // Auto-sync to GitHub if connected
  if (isGitHubConnected()) {
    await syncBarcodesToGitHub();
  }
}

function renderBarcodeChips() {
  const container = document.getElementById('barcodeChips');
  document.getElementById('barcodeCount').textContent = localBarcodes.length;

  if (localBarcodes.length === 0) {
    container.innerHTML = '<span style="color:#9ca3af;font-size:13px">No barcodes tracked</span>';
    return;
  }

  // Separate repo vs locally-added barcodes
  const newBarcodes = localBarcodes.filter(b => !repoBarcodes.includes(b));

  container.innerHTML = localBarcodes.map(b => {
    const isNew = !repoBarcodes.includes(b);
    return `<span class="chip ${isNew ? 'chip-new' : ''}">${b}${isNew ? '<span class="chip-badge">NEW</span>' : ''}<span class="remove" onclick="removeBarcode('${b}')">&times;</span></span>`;
  }).join('');

  // Show helper to copy new barcodes
  const helperEl = document.getElementById('newBarcodesHelper');
  if (newBarcodes.length > 0) {
    helperEl.style.display = 'block';
    helperEl.querySelector('.new-count').textContent = newBarcodes.length;
  } else {
    helperEl.style.display = 'none';
  }
}

function copyNewBarcodes() {
  const newBarcodes = localBarcodes.filter(b => !repoBarcodes.includes(b));
  const text = newBarcodes.map(b => `    "${b}"`).join(',\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyNewBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 2000);
  });
}

// ── CSV Export ──
function exportCSV() {
  const products = getProductList();
  const rows = [['Barcode', 'Product Name', 'Ninja Price (SAR)', 'Amazon Price (SAR)', 'HungerStation Price (SAR)', 'Best Platform', 'Best Price (SAR)']];

  for (const p of products) {
    rows.push([
      p.barcode,
      p.name || '',
      formatPrice(p.ninja) || '',
      formatPrice(p.amazon) || '',
      formatPrice(p.hungerstation) || '',
      p.bestPlatform || '',
      formatPrice(p.bestPrice) || '',
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

// ── GitHub Sync ──
function getGitHubSettings() {
  return JSON.parse(localStorage.getItem('ghSettings') || 'null');
}

function isGitHubConnected() {
  const s = getGitHubSettings();
  return s && s.user && s.repo && s.token;
}

function openSettings() {
  const s = getGitHubSettings() || {};
  document.getElementById('ghUser').value = s.user || '';
  document.getElementById('ghRepo').value = s.repo || '';
  document.getElementById('ghToken').value = s.token || '';
  document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

function saveSettings() {
  const user = document.getElementById('ghUser').value.trim();
  const repo = document.getElementById('ghRepo').value.trim();
  const token = document.getElementById('ghToken').value.trim();

  if (!user || !repo || !token) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  localStorage.setItem('ghSettings', JSON.stringify({ user, repo, token }));
  closeSettings();
  updateSettingsIndicator();
  showToast('GitHub settings saved! Barcodes will now sync automatically.', 'success');
}

function updateSettingsIndicator() {
  const btn = document.getElementById('settingsBtn');
  if (isGitHubConnected()) {
    btn.style.borderColor = '#10b981';
    btn.title = 'GitHub Connected (click to edit)';
  } else {
    btn.style.borderColor = '';
    btn.title = 'GitHub Settings (not connected)';
  }
}

async function syncBarcodesToGitHub() {
  const settings = getGitHubSettings();
  if (!settings) return false;

  const { user, repo, token } = settings;
  const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/data/barcodes.json`;

  try {
    // Get current file (need SHA for update)
    const getRes = await fetch(apiUrl, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
    });

    if (!getRes.ok) throw new Error(`GitHub API error: ${getRes.status}`);
    const fileData = await getRes.json();
    const currentContent = JSON.parse(atob(fileData.content));

    // Merge barcodes
    const merged = [...new Set([...(currentContent.barcodes || []), ...localBarcodes])];
    const updatedContent = {
      ...currentContent,
      barcodes: merged,
    };

    // Update file
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Update barcodes (${merged.length} total)`,
        content: btoa(JSON.stringify(updatedContent, null, 2)),
        sha: fileData.sha,
      }),
    });

    if (!putRes.ok) throw new Error(`GitHub update failed: ${putRes.status}`);

    repoBarcodes = merged;
    return true;
  } catch (err) {
    console.error('GitHub sync failed:', err);
    return false;
  }
}

async function triggerScraper() {
  const settings = getGitHubSettings();
  if (!settings) return;

  const { user, repo, token } = settings;
  try {
    await fetch(`https://api.github.com/repos/${user}/${repo}/actions/workflows/scrape.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
  } catch {}
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === 'success' ? '&#10003;' : '&#10007;'} ${message}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Init ──
document.getElementById('newBarcode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBarcode();
});

updateSettingsIndicator();
loadData();
