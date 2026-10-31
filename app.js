const DATA_FILE = 'portfolio.csv';
const CSV_STORAGE_KEY = 'portfolio-dashboard.csv';
const TRANSACTIONS_STORAGE_KEY = 'portfolio-dashboard.transactions';
const TRANSACTION_EDITS_STORAGE_KEY = 'portfolio-dashboard.transaction-edits';
const palette = ['#17231f', '#789d59', '#4d87a8', '#d98c62', '#8c79a8', '#c5b75c', '#6b9b96', '#b66e75'];
let rows = [];
let charts = {};
let targetPortfolioValue = 1000000;
let targetAllocations = {};
let historicalData = {};
let currentQuotes = new Map();
let currentQuoteRequests = new Map();
let editingTransactionId = null;
let symbolSearchTimer;
let symbolSearchController;

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value || 0);
const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 7 }).format(value || 0);
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
  return lines.slice(1).map((line, index) => {
    const fields = splitCSV(line); const typeIndex = fields.findLastIndex(value => ['BUY', 'SELL'].includes(clean(value).toUpperCase()));
    const rawTradeDate = clean(fields[9]);
    const tradeDate = /^\d{8}$/.test(rawTradeDate)
      ? `${rawTradeDate.slice(0, 4)}-${rawTradeDate.slice(4, 6)}-${rawTradeDate.slice(6, 8)}`
      : rawTradeDate.replace(/\//g, '-');
    return { id: `csv-${index}`, source: 'csv', symbol: clean(fields[0]), price: Number(fields[1]) || 0, change: Number(fields[4]) || 0, purchase: Number(fields[10]) || 0, quantity: Number(fields[11]) || 0, commission: Number(fields[12]) || 0, type: typeIndex > -1 ? clean(fields[typeIndex]).toUpperCase() : '', tradeDate, note: clean(fields[15]) };
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
  return transactions.map((row, index) => ({
    ...row,
    id: row.id || `saved-${index}`,
    source: 'saved'
  }));
}

function loadTransactionEdits() {
  const saved = localStorage.getItem(TRANSACTION_EDITS_STORAGE_KEY);
  if (!saved) return {};

  const edits = JSON.parse(saved);
  if (!edits || Array.isArray(edits) || typeof edits !== 'object') {
    throw new Error('ข้อมูลการแก้ไขรายการซื้อขายไม่ถูกต้อง');
  }
  return edits;
}

function applyTransactionEdits(transactions, edits) {
  return transactions.map(row => edits[row.id] ? { ...row, ...edits[row.id] } : row);
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

function updateDipCalculator() {
  const portfolio = aggregate(rows);
  const symbol = document.querySelector('#dipSymbol').value;
  const holding = portfolio.find(item => item.symbol === symbol);
  const dropPercent = Number(document.querySelector('#dipPercent').value);
  const quantity = Number(document.querySelector('#dipQuantity').value);
  const quote = document.querySelector('#dipCurrentPrice');
  const buyPriceOutput = document.querySelector('#dipBuyPrice');
  const investmentOutput = document.querySelector('#dipInvestment');
  const scenarioBody = document.querySelector('#dipScenarioBody');
  const status = document.querySelector('#dipCalculatorStatus');

  scenarioBody.replaceChildren();
  if (!holding) {
    quote.textContent = 'ราคาปัจจุบัน —';
    buyPriceOutput.textContent = '—';
    investmentOutput.textContent = '—';
    status.textContent = 'ยังไม่มีหุ้นที่ถือครองสำหรับคำนวณ';
    return;
  }

  quote.textContent = `ราคาปัจจุบัน ${money(holding.price)}`;
  if (!Number.isFinite(dropPercent) || dropPercent < 0 || dropPercent >= 100 ||
      !Number.isFinite(quantity) || quantity <= 0) {
    buyPriceOutput.textContent = '—';
    investmentOutput.textContent = '—';
    status.textContent = 'กรุณาระบุเปอร์เซ็นต์ที่ลด (0 ถึงน้อยกว่า 100) และจำนวนหุ้นที่มากกว่า 0';
    return;
  }

  const buyPrice = holding.price * (1 - dropPercent / 100);
  const investment = buyPrice * quantity;
  buyPriceOutput.textContent = money(buyPrice);
  investmentOutput.textContent = money(investment);

  [10, 20, 30].forEach(gainPercent => {
    const targetPrice = buyPrice * (1 + gainPercent / 100);
    const profit = (targetPrice - buyPrice) * quantity;
    const row = document.createElement('tr');
    [ `+${gainPercent}%`, money(targetPrice), signedMoney(profit) ].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 2) cell.className = 'positive';
      row.append(cell);
    });
    scenarioBody.append(row);
  });

  status.textContent = `คำนวณจากราคาหุ้น ${symbol} ปัจจุบัน หากราคาลดลง ${dropPercent}% แล้วซื้อ ${number(quantity)} หุ้น`;
}

function renderDipCalculator(portfolio) {
  const select = document.querySelector('#dipSymbol');
  const previousSymbol = select.value;
  select.replaceChildren();

  if (!portfolio.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'ไม่มีหุ้นในพอร์ต';
    select.append(option);
    select.disabled = true;
    updateDipCalculator();
    return;
  }

  portfolio.forEach(item => {
    const option = document.createElement('option');
    option.value = item.symbol;
    option.textContent = item.symbol;
    select.append(option);
  });
  select.disabled = false;
  select.value = portfolio.some(item => item.symbol === previousSymbol)
    ? previousSymbol
    : portfolio[0].symbol;
  updateDipCalculator();
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
    cell.colSpan = 8;
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

    const actionCell = document.createElement('td');
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'edit-transaction-button';
    editButton.dataset.transactionId = row.id;
    editButton.textContent = 'แก้ไข';
    actionCell.append(editButton);
    tableRow.append(actionCell);
    body.append(tableRow);
  });

  body.querySelectorAll('.edit-transaction-button').forEach(button => {
    button.addEventListener('click', () => startEditingTransaction(button.dataset.transactionId));
  });
}

function startEditingTransaction(id) {
  const transaction = rows.find(row => row.id === id);
  if (!transaction) return;

  editingTransactionId = id;
  const form = document.querySelector('#transactionForm');
  form.elements.symbol.value = transaction.symbol;
  form.elements.date.value = transaction.tradeDate;
  form.elements.type.value = transaction.type;
  form.elements.price.value = transaction.purchase;
  form.elements.quantity.value = transaction.quantity;
  form.elements.commission.value = transaction.commission;
  form.elements.note.value = transaction.note || '';
  document.querySelector('#transactionSubmitButton').textContent = 'บันทึกการแก้ไข';
  document.querySelector('#cancelTransactionEditButton').hidden = false;
  document.querySelector('#transactionFormStatus').textContent = `กำลังแก้ไขรายการ ${transaction.symbol}`;
  document.querySelector('#transactionsView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelTransactionEdit() {
  editingTransactionId = null;
  const form = document.querySelector('#transactionForm');
  form.reset();
  form.elements.date.value = getLocalDateString();
  form.elements.commission.value = '0';
  document.querySelector('#transactionSubmitButton').textContent = 'เพิ่มรายการ';
  document.querySelector('#cancelTransactionEditButton').hidden = true;
  document.querySelector('#transactionFormStatus').textContent = '';
  document.querySelector('#symbolSearchHint').textContent = '';
  document.querySelector('#symbolQuoteHint').textContent = '';
}

async function searchTransactionSymbols(query) {
  const datalist = document.querySelector('#symbolSuggestions');
  const hint = document.querySelector('#symbolSearchHint');
  if (symbolSearchController) symbolSearchController.abort();
  clearTimeout(symbolSearchTimer);

  const normalizedQuery = query.trim().toUpperCase();
  if (normalizedQuery.length < 2) {
    datalist.replaceChildren();
    hint.textContent = '';
    return;
  }

  const localSymbols = [...new Set(rows.map(row => row.symbol))]
    .filter(symbol => symbol.includes(normalizedQuery))
    .map(symbol => ({ symbol, name: '' }));
  datalist.replaceChildren(...localSymbols.map(item => {
    const option = document.createElement('option');
    option.value = item.symbol;
    return option;
  }));
  hint.textContent = 'กำลังค้นหาสัญลักษณ์...';

  symbolSearchTimer = setTimeout(async () => {
    const controller = new AbortController();
    symbolSearchController = controller;
    try {
      const response = await fetch(`/api/symbols?query=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ค้นหาสัญลักษณ์ไม่สำเร็จ');
      const options = new Map([...localSymbols, ...result].map(item => [item.symbol, item]));
      datalist.replaceChildren(...[...options.values()].map(item => {
        const option = document.createElement('option');
        option.value = item.symbol;
        option.label = item.name ? `${item.symbol} — ${item.name}` : item.symbol;
        return option;
      }));
      hint.textContent = result.length ? 'เลือกสัญลักษณ์จากคำแนะนำ หรือพิมพ์ต่อ' : 'ไม่พบคำแนะนำ ใช้สัญลักษณ์ที่พิมพ์ได้';
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Could not search symbols:', error);
      hint.textContent = `ค้นหาคำแนะนำไม่ได้: ${error.message}`;
    }
  }, 400);
}

function loadCachedQuotes() {
  const saved = localStorage.getItem('portfolio-dashboard.quotes');
  if (!saved) return;
  const quotes = JSON.parse(saved);
  if (!quotes || Array.isArray(quotes) || typeof quotes !== 'object') {
    throw new Error('ข้อมูลราคาหุ้นที่บันทึกไว้ไม่ถูกต้อง');
  }
  Object.entries(quotes).forEach(([symbol, quote]) => {
    if (quote && Number.isFinite(quote.price) && quote.price > 0 && typeof quote.date === 'string') {
      currentQuotes.set(symbol, quote);
    }
  });
}

function saveCachedQuotes() {
  try {
    localStorage.setItem('portfolio-dashboard.quotes', JSON.stringify(Object.fromEntries(currentQuotes)));
  } catch (error) {
    console.error('Could not save cached quotes:', error);
    document.querySelector('#symbolQuoteHint').textContent = `บันทึกราคาล่าสุดไม่สำเร็จ: ${error.message}`;
  }
}

function renderPortfolioData() {
  const portfolio = aggregate(rows);
  updateText(portfolio);
  renderCharts(portfolio);
  renderTable(portfolio);
  renderDipCalculator(portfolio);
  renderHistoryChart();
  renderTransactions();
}

function applyQuoteToRows(quote) {
  rows = rows.map(row => row.symbol === quote.symbol
    ? { ...row, price: quote.price, change: quote.change }
    : row);
  renderPortfolioData();
}

async function fetchSymbolQuote(symbol) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const cached = currentQuotes.get(normalizedSymbol);
  if (cached && Date.now() - cached.fetchedAt < 15 * 60 * 1000) return cached;

  if (currentQuoteRequests.has(normalizedSymbol)) return currentQuoteRequests.get(normalizedSymbol);

  const request = (async () => {
    const response = await fetch(`/api/quote?symbol=${encodeURIComponent(normalizedSymbol)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `โหลดราคา ${normalizedSymbol} ไม่สำเร็จ`);
    if (!Number.isFinite(result.price) || result.price <= 0) {
      throw new Error(`ไม่พบราคาล่าสุดของ ${normalizedSymbol}`);
    }

    const quote = { ...result, fetchedAt: Date.now() };
    currentQuotes.set(normalizedSymbol, quote);
    saveCachedQuotes();
    applyQuoteToRows(quote);
    return quote;
  })();
  currentQuoteRequests.set(normalizedSymbol, request);
  try {
    return await request;
  } finally {
    currentQuoteRequests.delete(normalizedSymbol);
  }
}

async function refreshSymbolQuote() {
  const symbol = clean(document.querySelector('#transactionSymbol').value).toUpperCase();
  const hint = document.querySelector('#symbolQuoteHint');
  if (!symbol || !/^[A-Z0-9.-]+$/.test(symbol)) return;

  hint.textContent = 'กำลังโหลดราคาล่าสุด...';
  try {
    const quote = await fetchSymbolQuote(symbol);
    if (clean(document.querySelector('#transactionSymbol').value).toUpperCase() === symbol) {
      hint.textContent = `ราคาปิดล่าสุดจาก Tiingo ${quote.date.slice(0, 10)}: ${money(quote.price)}`;
    }
  } catch (error) {
    console.error('Could not load current quote:', error);
    if (clean(document.querySelector('#transactionSymbol').value).toUpperCase() === symbol) {
      hint.textContent = `โหลดราคาหุ้นไม่ได้: ${error.message}`;
    }
  }
}

async function submitTransaction(event) {
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

  const editedRow = editingTransactionId
    ? rows.find(row => row.id === editingTransactionId)
    : null;
  if (editingTransactionId && !editedRow) {
    status.textContent = 'ไม่พบรายการที่ต้องการแก้ไข กรุณาโหลดหน้าใหม่';
    return;
  }

  if (type === 'SELL') {
    const validationRows = editedRow
      ? rows.filter(row => row.id !== editedRow.id)
      : rows;
    const holding = aggregate(validationRows).find(item => item.symbol === symbol);
    if (!holding || quantity > holding.quantity + 0.00000001) {
      status.textContent = 'จำนวนขายมากกว่าหุ้นที่ถืออยู่';
      return;
    }
  }

  const submitButton = document.querySelector('#transactionSubmitButton');
  submitButton.disabled = true;
  status.textContent = 'กำลังตรวจสอบราคาล่าสุด...';
  let quote;
  try {
    quote = await fetchSymbolQuote(symbol);
  } catch (error) {
    console.error('Could not verify current quote:', error);
    status.textContent = `บันทึกรายการไม่ได้ เพราะโหลดราคาปัจจุบันไม่สำเร็จ: ${error.message}`;
    submitButton.disabled = false;
    return;
  }

  const transaction = {
    id: editedRow ? editedRow.id : `saved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: editedRow ? editedRow.source : 'saved',
    symbol,
    price: quote.price,
    change: quote.change,
    purchase,
    quantity,
    commission,
    type,
    tradeDate,
    note
  };
  try {
    if (editedRow && editedRow.source === 'csv') {
      const edits = loadTransactionEdits();
      edits[editedRow.id] = { symbol, purchase, quantity, commission, type, tradeDate, note };
      localStorage.setItem(TRANSACTION_EDITS_STORAGE_KEY, JSON.stringify(edits));
    } else {
      const savedTransactions = loadSavedTransactions();
      const nextTransactions = editedRow
        ? savedTransactions.map(row => row.id === editedRow.id ? transaction : row)
        : [...savedTransactions, transaction];
      localStorage.setItem(TRANSACTIONS_STORAGE_KEY, JSON.stringify(nextTransactions));
    }
  } catch (error) {
    console.error('Could not save transaction:', error);
    status.textContent = `บันทึกรายการไม่สำเร็จ: ${error.message || 'ข้อมูลที่บันทึกไว้ไม่ถูกต้อง'}`;
    submitButton.disabled = false;
    return;
  }

  rows = editedRow
    ? rows.map(row => row.id === editedRow.id ? transaction : row)
    : [...rows, transaction];
  renderPortfolioData();
  cancelTransactionEdit();
  status.textContent = editedRow
    ? 'แก้ไขรายการซื้อขายเรียบร้อย และบันทึกไว้ในอุปกรณ์นี้'
    : 'เพิ่มรายการซื้อขายเรียบร้อย และบันทึกไว้ในอุปกรณ์นี้';
  submitButton.disabled = false;
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
    Object.entries(data).forEach(([symbol, history]) => {
      const latest = history[history.length - 1];
      if (latest && Number.isFinite(latest.price) && latest.price > 0) {
        currentQuotes.set(symbol, {
          symbol,
          price: latest.price,
          change: history.length > 1 ? latest.price - history[history.length - 2].price : 0,
          date: latest.date,
          fetchedAt: Date.now()
        });
      }
    });
    rows = rows.map(row => {
      const quote = currentQuotes.get(row.symbol);
      return quote ? { ...row, price: quote.price, change: quote.change } : row;
    });
    saveCachedQuotes();
    renderPortfolioData();

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

async function renderPortfolio(csvText, extraTransactions = [], transactionEdits = {}) {
  const importedRows = parseCSV(csvText);
  if (!importedRows.length) throw new Error('ไฟล์ CSV ไม่มีรายการที่อ่านได้');

  rows = [...applyTransactionEdits(importedRows, transactionEdits), ...extraTransactions]
    .map(row => {
      const quote = currentQuotes.get(row.symbol);
      return quote ? { ...row, price: quote.price, change: quote.change } : row;
    });
  const portfolio = aggregate(rows);
  updateText(portfolio);
  renderCharts(portfolio);
  renderTable(portfolio);
  renderDipCalculator(portfolio);
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
      const transactionEdits = loadTransactionEdits();
      loadCachedQuotes();
      let csvText = savedCSV;
      if (!csvText) {
        const response = await fetch(DATA_FILE);
        if (!response.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ');
        csvText = await response.text();
      }
      await renderPortfolio(csvText, savedTransactions, transactionEdits);
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
    const transactionEdits = loadTransactionEdits();
    const editedCount = Object.keys(transactionEdits).length;
    if ((savedTransactions.length || editedCount) && !confirm(`การนำเข้า CSV ใหม่จะลบรายการที่เพิ่มเอง ${savedTransactions.length} รายการ และการแก้ไขเดิม ${editedCount} รายการ ต้องการดำเนินการต่อหรือไม่?`)) return;
    localStorage.setItem(CSV_STORAGE_KEY, csvText);
    localStorage.removeItem(TRANSACTIONS_STORAGE_KEY);
    localStorage.removeItem(TRANSACTION_EDITS_STORAGE_KEY);
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
document.querySelector('#dipSymbol').addEventListener('change', updateDipCalculator);
document.querySelector('#dipPercent').addEventListener('input', updateDipCalculator);
document.querySelector('#dipQuantity').addEventListener('input', updateDipCalculator);
document.querySelector('#refreshHistoryButton').addEventListener('click', refreshHistoricalData);
document.querySelector('#transactionForm').addEventListener('submit', submitTransaction);
document.querySelector('#transactionDate').value = getLocalDateString();
document.querySelector('#transactionSymbol').addEventListener('input', event => searchTransactionSymbols(event.target.value));
document.querySelector('#transactionSymbol').addEventListener('blur', refreshSymbolQuote);
document.querySelector('#cancelTransactionEditButton').addEventListener('click', cancelTransactionEdit);

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
