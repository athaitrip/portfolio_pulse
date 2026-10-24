const DATA_FILE = 'portfolio.csv';
const CSV_STORAGE_KEY = 'portfolio-dashboard.csv';
const TRANSACTIONS_STORAGE_KEY = 'portfolio-dashboard.transactions';
const palette = ['#17231f', '#789d59', '#4d87a8', '#d98c62', '#8c79a8', '#c5b75c', '#6b9b96', '#b66e75'];
let rows = [];
let charts = {};
let targetPortfolioValue = 1000000;
let targetAllocations = {};
let historicalData = {};

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value || 0);
const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value || 0);
const signedMoney = value => `${value >= 0 ? '+' : '-'}${money(Math.abs(value))}`;
const signedPercent = value => `${value >= 0 ? '+' : ''}${(value || 0).toFixed(2)}%`;
const clean = value => (value || '').trim();

function splitCSV(line) {
  const result = []; let field = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { result.push(field); field = ''; }
    else field += char;
  }
  result.push(field); return result;
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map(line => {
    const fields = splitCSV(line); const typeIndex = fields.findLastIndex(value => ['BUY', 'SELL'].includes(clean(value).toUpperCase()));
    const rawTradeDate = clean(fields[9]);
    const tradeDate = /^\d{8}$/.test(rawTradeDate)
      ? `${rawTradeDate.slice(0, 4)}-${rawTradeDate.slice(4, 6)}-${rawTradeDate.slice(6, 8)}`
      : rawTradeDate.replace(/\//g, '-');
    return { symbol: clean(fields[0]), price: Number(fields[1]) || 0, change: Number(fields[4]) || 0, purchase: Number(fields[10]) || 0, quantity: Number(fields[11]) || 0, commission: Number(fields[12]) || 0, type: typeIndex > -1 ? clean(fields[typeIndex]).toUpperCase() : '', tradeDate, note: clean(fields[15]) };
  }).filter(row => row.symbol && row.price);
}

function loadSavedTransactions() {
  const saved = localStorage.getItem(TRANSACTIONS_STORAGE_KEY);
  if (!saved) return [];

  const transactions = JSON.parse(saved);
  if (!Array.isArray(transactions) || transactions.some(row =>
    !row || typeof row.symbol !== 'string' || !Number.isFinite(row.price) ||
    !Number.isFinite(row.quantity) || !Number.isFinite(row.commission) ||
    !['BUY', 'SELL'].includes(row.type) || typeof row.tradeDate !== 'string'
  )) {
    throw new Error('ข้อมูลรายการซื้อขายที่บันทึกไว้ไม่ถูกต้อง กรุณานำเข้าไฟล์ CSV ใหม่');
  }
  return transactions;
}

function aggregate(data) {
  const grouped = new Map();
  data.forEach(row => {
    if (!grouped.has(row.symbol)) grouped.set(row.symbol, { symbol: row.symbol, price: row.price, change: row.change, quantity: 0, cost: 0, commission: 0 });
    const item = grouped.get(row.symbol); item.price = row.price; item.change = row.change;
    if (row.type === 'BUY') { item.quantity += row.quantity; item.cost += row.purchase * row.quantity; item.commission += row.commission; }
    if (row.type === 'SELL') { item.quantity -= row.quantity; item.cost -= row.purchase * row.quantity; item.commission += row.commission; }
  });
  return [...grouped.values()].filter(item => item.quantity > 0.00001).map(item => ({ ...item, value: item.price * item.quantity, average: item.cost / item.quantity, profit: item.price * item.quantity - item.cost, dayValue: item.change * item.quantity, returnPct: item.cost ? (item.price * item.quantity - item.cost) / item.cost * 100 : 0 })).sort((a, b) => b.value - a.value);
}

function updateText(portfolio) {
  const value = portfolio.reduce((sum, item) => sum + item.value, 0); const cost = portfolio.reduce((sum, item) => sum + item.cost, 0); const profit = portfolio.reduce((sum, item) => sum + item.profit, 0); const day = portfolio.reduce((sum, item) => sum + item.dayValue, 0);
  document.querySelector('#portfolioValue').textContent = money(value); document.querySelector('#costBasis').textContent = money(cost); document.querySelector('#profitLoss').textContent = signedMoney(profit); document.querySelector('#profitLoss').className = profit >= 0 ? 'positive' : 'negative'; document.querySelector('#returnPercent').textContent = `${signedPercent(cost ? profit / cost * 100 : 0)} จากต้นทุน`; document.querySelector('#dayChange').textContent = signedMoney(day); document.querySelector('#dayChange').className = day >= 0 ? 'positive' : 'negative'; document.querySelector('#holdingCount').textContent = `${portfolio.length} สินทรัพย์ที่ยังถือครอง`; document.querySelector('#donutTotal').textContent = money(value).replace('.00', '');
  
  document.querySelector('#targetValue').textContent = money(targetPortfolioValue);
  const progressPct = Math.min((value / targetPortfolioValue) * 100, 100);
  document.querySelector('#targetProgress').textContent = `ความคืบหน้า ${progressPct.toFixed(2)}%`;
}

function renderCharts(portfolio) {
  if (charts.allocation) charts.allocation.destroy();
  if (charts.performance) charts.performance.destroy();
  const top = portfolio.slice(0, 8); const colors = top.map((_, index) => palette[index]);
  charts.allocation = new Chart(document.querySelector('#allocationChart'), { type: 'doughnut', data: { labels: top.map(item => item.symbol), datasets: [{ data: top.map(item => item.value), backgroundColor: colors, borderWidth: 0, hoverOffset: 5 }] }, options: { cutout: '76%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => ` ${context.label}: ${money(context.raw)}` } } } } });
  charts.performance = new Chart(document.querySelector('#performanceChart'), { type: 'bar', data: { labels: top.map(item => item.symbol), datasets: [{ data: top.map(item => item.profit), backgroundColor: top.map(item => item.profit >= 0 ? '#789d59' : '#e06b5c'), borderRadius: 2, barThickness: 19 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => ` ${signedMoney(context.raw)}` } } }, scales: { x: { grid: { color: '#edf1ee' }, ticks: { color: '#71807b', font: { family: 'DM Mono', size: 10 }, callback: value => `$${Math.round(value)}` } }, y: { grid: { display: false }, ticks: { color: '#17231f', font: { family: 'DM Mono', size: 11 } } } } } });
  document.querySelector('#allocationLegend').innerHTML = top.slice(0, 6).map((item, index) => `<div class="legend-item"><i class="legend-swatch" style="background:${colors[index]}"></i><span>${item.symbol}</span><span>${(item.value / portfolio.reduce((sum, current) => sum + current.value, 0) * 100).toFixed(1)}%</span></div>`).join('');
}

function renderTable(portfolio) {
  const query = clean(document.querySelector('#searchInput').value).toUpperCase(); const sort = document.querySelector('#sortSelect').value; const filtered = portfolio.filter(item => item.symbol.includes(query)).sort((a, b) => sort === 'pl' ? b.profit - a.profit : sort === 'change' ? b.dayValue - a.dayValue : sort === 'symbol' ? a.symbol.localeCompare(b.symbol) : b.value - a.value);
  
  const totalValue = portfolio.reduce((sum, item) => sum + item.value, 0);
  
  document.querySelector('#holdingsBody').innerHTML = filtered.length ? filtered.map(item => {
    const currentPct = (item.value / totalValue) * 100 || 0;
    const targetPct = targetAllocations[item.symbol] || 0;
    const diffPct = currentPct - targetPct;
    const diffClass = Math.abs(diffPct) > 5 ? 'negative' : 'positive';
    return `<tr><td><div class="symbol-cell"><span class="symbol-badge">${item.symbol.slice(0, 2)}</span>${item.symbol}</div></td><td>${number(item.quantity)}</td><td>${money(item.price)}</td><td>${money(item.average)}</td><td>${money(item.value)}</td><td class="${item.profit >= 0 ? 'positive' : 'negative'}">${signedMoney(item.profit)} <small>(${signedPercent(item.returnPct)})</small></td><td class="${item.change >= 0 ? 'positive' : 'negative'}">${signedMoney(item.dayValue)}</td><td>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
        <div style="display:flex; align-items:center; gap:4px;">
          <input type="number" class="target-pct-input" data-symbol="${item.symbol}" value="${targetPct}" step="0.1" min="0" max="100" style="width:50px; text-align:right; border:1px solid var(--line); border-radius:3px; padding:2px; font-family:DM Mono;"> %
        </div>
        <span style="font-size:9px;" class="${diffClass}">ปัจจุบัน: ${currentPct.toFixed(1)}%</span>
      </div>
    </td></tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">ไม่พบข้อมูลที่ค้นหา</td></tr>';
  
  document.querySelectorAll('.target-pct-input').forEach(input => {
    input.addEventListener('change', (e) => {
      targetAllocations[e.target.dataset.symbol] = parseFloat(e.target.value) || 0;
      renderTable(aggregate(rows));
    });
  });
  
  document.querySelector('#rowStatus').textContent = `แสดง ${filtered.length} จาก ${portfolio.length} สินทรัพย์`;
}

function renderTransactions() {
  const transactionRows = rows
    .filter(row => row.type === 'BUY' || row.type === 'SELL')
    .map((row, index) => ({ ...row, originalIndex: index }))
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.originalIndex - a.originalIndex);
  const body = document.querySelector('#transactionsBody');
  const count = document.querySelector('#transactionCount');
  body.replaceChildren();
  count.textContent = `${transactionRows.length} รายการ`;

  if (!transactionRows.length) {
    const tableRow = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'empty';
    cell.textContent = 'ยังไม่มีรายการซื้อขาย';
    tableRow.append(cell);
    body.append(tableRow);
    return;
  }

  transactionRows.forEach(row => {
    const tableRow = document.createElement('tr');
    const values = [
      row.tradeDate || '—',
      row.symbol,
      row.type,
      number(row.quantity),
      money(row.purchase),
      money(row.commission),
      row.note || '—'
    ];

    values.forEach((value, index) => {
      const cell = document.createElement('td');
      if (index === 2) {
        const badge = document.createElement('span');
        badge.className = `transaction-type ${row.type === 'BUY' ? 'buy' : 'sell'}`;
        badge.textContent = row.type === 'BUY' ? 'ซื้อ' : 'ขาย';
        cell.append(badge);
      } else {
        cell.textContent = value;
      }
      tableRow.append(cell);
    });

    body.append(tableRow);
  });
}

function addTransaction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#transactionFormStatus');
  const symbol = clean(form.elements.symbol.value).toUpperCase();
  const type = form.elements.type.value;
  const tradeDate = form.elements.date.value;
  const purchase = Number(form.elements.price.value);
  const quantity = Number(form.elements.quantity.value);
  const commission = Number(form.elements.commission.value);
  const note = clean(form.elements.note.value);

  if (!/^[A-Z0-9.-]+$/.test(symbol)) {
    status.textContent = 'กรุณาระบุสัญลักษณ์หุ้นให้ถูกต้อง';
    return;
  }
  if (!tradeDate || !Number.isFinite(purchase) || purchase <= 0 ||
      !Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isFinite(commission) || commission < 0 ||
      !['BUY', 'SELL'].includes(type)) {
    status.textContent = 'กรุณาตรวจสอบวันที่ ราคา จำนวนหุ้น และค่าคอมมิชชัน';
    return;
  }

  if (type === 'SELL') {
    const holding = aggregate(rows).find(item => item.symbol === symbol);
    if (!holding || quantity > holding.quantity + 0.00000001) {
      status.textContent = 'จำนวนขายมากกว่าหุ้นที่ถืออยู่';
      return;
    }
  }

  const currentQuote = rows.find(row => row.symbol === symbol);
  const transaction = {
    symbol,
    price: currentQuote ? currentQuote.price : purchase,
    change: currentQuote ? currentQuote.change : 0,
    purchase,
    quantity,
    commission,
    type,
    tradeDate,
    note
  };
  let nextSavedTransactions;
  try {
    nextSavedTransactions = [...loadSavedTransactions(), transaction];
    localStorage.setItem(TRANSACTIONS_STORAGE_KEY, JSON.stringify(nextSavedTransactions));
  } catch (error) {
    console.error('Could not save transaction:', error);
    status.textContent = `บันทึกรายการไม่สำเร็จ: ${error.message || 'ข้อมูลที่บันทึกไว้ไม่ถูกต้อง'}`;
    return;
  }

  rows.push(transaction);
  const portfolio = aggregate(rows);
  updateText(portfolio);
  renderCharts(portfolio);
  renderTable(portfolio);
  renderHistoryChart();
  renderTransactions();
  status.textContent = 'เพิ่มรายการซื้อขายเรียบร้อย และบันทึกไว้ในอุปกรณ์นี้';
  form.reset();
  form.elements.date.value = getLocalDateString();
  form.elements.commission.value = '0';
}

function getLocalDateString() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function calculateReturns(dataArray, days) {
  if (!dataArray || dataArray.length === 0) return [];
  const recent = dataArray.slice(-days);
  if (recent.length === 0) return [];
  const basePrice = recent[0].close;
  return recent.map(d => ({
    date: d.date,
    returnPct: ((d.close - basePrice) / basePrice) * 100
  }));
}

function calculatePortfolioReturns(transactions, priceData, dates) {
  if (!dates.length) return [];

  const pricesByDate = new Map();
  Object.entries(priceData).forEach(([symbol, history]) => {
    history.forEach(item => {
      const date = item.date.slice(0, 10);
      if (!pricesByDate.has(date)) pricesByDate.set(date, new Map());
      pricesByDate.get(date).set(symbol, item.close);
    });
  });

  const trades = transactions
    .filter(row => row.tradeDate && (row.type === 'BUY' || row.type === 'SELL'))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const quantities = new Map();
  const prices = new Map();
  let tradeIndex = 0;
  let portfolioIndex = 1;
  let previousPrices;

  const applyTrade = trade => {
    const quantity = quantities.get(trade.symbol) || 0;
    const change = trade.type === 'BUY' ? trade.quantity : -trade.quantity;
    quantities.set(trade.symbol, quantity + change);
  };

  while (tradeIndex < trades.length && trades[tradeIndex].tradeDate < dates[0]) {
    applyTrade(trades[tradeIndex]);
    tradeIndex += 1;
  }

  return dates.map(date => {
    const dailyPrices = pricesByDate.get(date);
    if (dailyPrices) dailyPrices.forEach((price, symbol) => {
      if (Number.isFinite(price) && price > 0) prices.set(symbol, price);
    });

    if (previousPrices) {
      let previousValue = 0;
      let dailyGain = 0;
      quantities.forEach((quantity, symbol) => {
        const previousPrice = previousPrices.get(symbol);
        const currentPrice = prices.get(symbol);
        if (quantity > 0 && previousPrice > 0 && currentPrice > 0) {
          previousValue += quantity * previousPrice;
          dailyGain += quantity * (currentPrice - previousPrice);
        }
      });
      if (previousValue > 0) portfolioIndex *= 1 + dailyGain / previousValue;
    }

    while (tradeIndex < trades.length && trades[tradeIndex].tradeDate <= date) {
      applyTrade(trades[tradeIndex]);
      tradeIndex += 1;
    }

    previousPrices = new Map(prices);
    return (portfolioIndex - 1) * 100;
  });
}

function renderHistoryChart() {
  if (charts.history) charts.history.destroy();
  const tf = document.querySelector('.tf-btn.active').dataset.tf;
  const showSP500 = document.querySelector('#compareSP500').checked;
  const showNASDAQ = document.querySelector('#compareNASDAQ').checked;
  
  let days = 30;
  if (tf === '1D') days = 2;
  else if (tf === '1M') days = 22;
  else if (tf === '6M') days = 130;
  else if (tf === '1Y') days = 252;
  else if (tf === 'YTD') {
    const diff = Math.abs(new Date() - new Date(new Date().getFullYear(), 0, 1));
    days = Math.floor(Math.ceil(diff / (1000 * 60 * 60 * 24)) * (252/365));
  }
  else if (tf === '3Y') days = 252 * 3;
  
  if (Object.keys(historicalData).length === 0) {
      charts.history = new Chart(document.querySelector('#historyChart'), {
          type: 'line', data: { labels: ['ไม่มีข้อมูล'], datasets: [] },
          options: { plugins: { title: { display: true, text: 'กด “รีเฟรชราคา” เพื่อโหลดข้อมูลย้อนหลัง' } } }
      });
      return;
  }

  const allDates = [...new Set(Object.values(historicalData).flatMap(history => history.map(item => item.date.slice(0, 10))))].sort();
  const baseDates = allDates.slice(-days);
  const portReturns = calculatePortfolioReturns(rows, historicalData, baseDates);
  const datasets = [
    { label: 'My Portfolio', data: portReturns, borderColor: '#789d59', backgroundColor: 'rgba(120, 157, 89, 0.1)', fill: true, tension: 0.2, borderWidth: 2, pointRadius: 0 }
  ];
  
  if (showSP500 && historicalData['SPY']) {
      const spyReturns = new Map(calculateReturns(historicalData['SPY'], days).map(item => [item.date.slice(0, 10), item.returnPct]));
      datasets.push({ label: 'S&P 500 (SPY)', data: baseDates.map(date => spyReturns.get(date) ?? null), borderColor: '#4d87a8', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.2, borderWidth: 1.5, pointRadius: 0 });
  }
  
  if (showNASDAQ && historicalData['QQQ']) {
      const qqqReturns = new Map(calculateReturns(historicalData['QQQ'], days).map(item => [item.date.slice(0, 10), item.returnPct]));
      datasets.push({ label: 'NASDAQ (QQQ)', data: baseDates.map(date => qqqReturns.get(date) ?? null), borderColor: '#8c79a8', backgroundColor: 'transparent', borderDash: [2, 2], tension: 0.2, borderWidth: 1.5, pointRadius: 0 });
  }

  charts.history = new Chart(document.querySelector('#historyChart'), {
    type: 'line',
    data: { labels: baseDates.map(d => d.substring(5)), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { font: { family: 'Manrope', size: 11 } } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%` } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 10 } },
        y: { grid: { color: '#edf1ee' }, ticks: { callback: val => val + '%', color: '#71807b', font: { family: 'DM Mono', size: 10 } } }
      }
    }
  });
}

async function fetchHistoricalData(symbols) {
    const fetchSymbols = [...new Set([...symbols, 'SPY', 'QQQ'])];
    const response = await fetch(`/api/history?symbols=${fetchSymbols.join(',')}`);
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to fetch history');
    }
    return response.json();
}

async function refreshHistoricalData() {
  const button = document.querySelector('#refreshHistoryButton');
  const buttonLabel = document.querySelector('#refreshButtonLabel');
  const status = document.querySelector('#historyStatus');
  const updatedAt = document.querySelector('#updatedAt');

  if (!rows.length) {
    status.textContent = 'ยังไม่มีข้อมูลพอร์ตสำหรับเรียกข้อมูลราคา';
    return;
  }

  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  buttonLabel.textContent = 'กำลังโหลด...';
  status.textContent = 'กำลังเรียกข้อมูลย้อนหลังจาก Tiingo...';
  updatedAt.textContent = 'กำลังรีเฟรชราคาย้อนหลัง...';

  try {
    const data = await fetchHistoricalData(rows.map(item => item.symbol));
    historicalData = data;
    renderHistoryChart();

    const latest = new Date();
    const timestamp = latest.toLocaleDateString('th-TH') + ' ' + latest.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    updatedAt.textContent = `ราคาอัปเดต ${timestamp}`;
    status.textContent = 'โหลดข้อมูลย้อนหลังเรียบร้อย';
  } catch (error) {
    console.error('Could not load historical data:', error);
    updatedAt.textContent = 'รีเฟรชราคาย้อนหลังไม่สำเร็จ';
    status.textContent = `เรียกข้อมูลไม่สำเร็จ: ${error.message}`;
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    buttonLabel.textContent = 'รีเฟรชราคา';
  }
}

async function renderPortfolio(csvText, extraTransactions = []) {
  const importedRows = parseCSV(csvText);
  if (!importedRows.length) throw new Error('ไฟล์ CSV ไม่มีรายการที่อ่านได้');

  rows = [...importedRows, ...extraTransactions];
  const portfolio = aggregate(rows);
  updateText(portfolio);
  renderCharts(portfolio);
  renderTable(portfolio);
  renderTransactions();

  historicalData = {};
  renderHistoryChart();
  document.querySelector('#updatedAt').textContent = 'ยังไม่ได้รีเฟรชราคาย้อนหลัง';
  document.querySelector('#historyStatus').textContent = 'กด “รีเฟรชราคา” เพื่อโหลดข้อมูลย้อนหลัง';
}

async function loadDashboard() {
  try { 
      const savedCSV = localStorage.getItem(CSV_STORAGE_KEY);
      const savedTransactions = loadSavedTransactions();
      let csvText = savedCSV;
      if (!csvText) {
        const response = await fetch(DATA_FILE);
        if (!response.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ');
        csvText = await response.text();
      }
      await renderPortfolio(csvText, savedTransactions);
      document.querySelector('#rowStatus').textContent = savedCSV
        ? 'แสดงข้อมูล CSV ที่บันทึกไว้ในอุปกรณ์นี้'
        : 'แสดงข้อมูลจาก portfolio.csv';
  } catch (error) { 
      document.querySelector('#updatedAt').textContent = 'กรุณานำเข้าไฟล์ CSV'; 
      document.querySelector('#rowStatus').textContent = error.message; 
  }
}

document.querySelector('#csvImport').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const csvText = await file.text();
    if (!parseCSV(csvText).length) throw new Error('ไฟล์ CSV ไม่มีรายการที่อ่านได้');
    const savedTransactions = loadSavedTransactions();
    if (savedTransactions.length && !confirm(`การนำเข้า CSV ใหม่จะลบรายการที่เพิ่มเอง ${savedTransactions.length} รายการ ต้องการดำเนินการต่อหรือไม่?`)) return;
    localStorage.setItem(CSV_STORAGE_KEY, csvText);
    localStorage.removeItem(TRANSACTIONS_STORAGE_KEY);
    await renderPortfolio(csvText);
    document.querySelector('#rowStatus').textContent = `นำเข้าและบันทึก ${file.name} ไว้ในอุปกรณ์นี้`;
  } catch (error) {
    document.querySelector('#rowStatus').textContent = `นำเข้าไม่สำเร็จ: ${error.message}`;
  } finally {
    event.target.value = '';
  }
});

document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    renderHistoryChart();
  });
});
document.querySelector('#compareSP500').addEventListener('change', renderHistoryChart);
document.querySelector('#compareNASDAQ').addEventListener('change', renderHistoryChart);

document.querySelector('#editTargetBtn').addEventListener('click', () => {
  const newVal = prompt("กรุณาระบุเป้าหมายมูลค่าพอร์ตใหม่ (เช่น 1500000):", targetPortfolioValue);
  if (newVal && !isNaN(newVal)) {
    targetPortfolioValue = parseFloat(newVal);
    updateText(aggregate(rows));
  }
});

document.querySelector('#searchInput').addEventListener('input', () => renderTable(aggregate(rows)));
document.querySelector('#sortSelect').addEventListener('change', () => renderTable(aggregate(rows)));
document.querySelector('#refreshHistoryButton').addEventListener('click', refreshHistoricalData);
document.querySelector('#transactionForm').addEventListener('submit', addTransaction);
document.querySelector('#transactionDate').value = getLocalDateString();

document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    const viewId = button.dataset.view;
    document.querySelectorAll('.tab-button').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.tab-view').forEach(view => {
      view.hidden = view.id !== viewId;
    });
  });
});

loadDashboard();
