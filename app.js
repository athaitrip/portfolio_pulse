const DATA_FILE = 'portfolio.csv';
const CSV_STORAGE_KEY = 'portfolio-dashboard.csv';
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
    return { symbol: clean(fields[0]), price: Number(fields[1]) || 0, change: Number(fields[4]) || 0, purchase: Number(fields[10]) || 0, quantity: Number(fields[11]) || 0, commission: Number(fields[12]) || 0, type: typeIndex > -1 ? clean(fields[typeIndex]).toUpperCase() : '' };
  }).filter(row => row.symbol && row.price);
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

function renderHistoryChart() {
  if (charts.history) charts.history.destroy();
  const tf = document.querySelector('.tf-btn.active').dataset.tf;
  const showSP500 = document.querySelector('#compareSP500').checked;
  const showNASDAQ = document.querySelector('#compareNASDAQ').checked;
  
  let days = 30; // 1M ~ 22 trading days, but we slice raw array, so approx
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
          options: { plugins: { title: { display: true, text: 'ยังไม่มีข้อมูล (กรุณาใส่ API Key ใน .env หรือกำลังโหลด)' } } }
      });
      return;
  }

  const portfolio = aggregate(rows);
  const totalValue = portfolio.reduce((sum, item) => sum + item.value, 0);
  
  let baseDates = historicalData['SPY'] ? historicalData['SPY'].map(d=>d.date).slice(-days) : [];
  if (baseDates.length === 0) {
      // fallback to any available symbol
      const anySym = Object.keys(historicalData)[0];
      if (anySym) baseDates = historicalData[anySym].map(d=>d.date).slice(-days);
  }
  
  const portReturns = baseDates.map(dateStr => {
      let totalReturnContrib = 0;
      let weightSum = 0;
      portfolio.forEach(item => {
          const w = item.value / totalValue;
          const hData = historicalData[item.symbol];
          if(hData) {
              const recent = hData.slice(-days);
              if(recent.length > 0) {
                  const basePrice = recent[0].close;
                  const dayData = recent.find(d => d.date === dateStr);
                  if (dayData) {
                      const r = ((dayData.close - basePrice) / basePrice) * 100;
                      totalReturnContrib += r * w;
                      weightSum += w;
                  }
              }
          }
      });
      // Normalize if some symbols lack data
      return weightSum > 0 ? (totalReturnContrib / weightSum) : 0;
  });

  const datasets = [
    { label: 'My Portfolio', data: portReturns, borderColor: '#789d59', backgroundColor: 'rgba(120, 157, 89, 0.1)', fill: true, tension: 0.2, borderWidth: 2, pointRadius: 0 }
  ];
  
  if (showSP500 && historicalData['SPY']) {
      const spyRet = calculateReturns(historicalData['SPY'], days);
      datasets.push({ label: 'S&P 500 (SPY)', data: spyRet.map(d=>d.returnPct), borderColor: '#4d87a8', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.2, borderWidth: 1.5, pointRadius: 0 });
  }
  
  if (showNASDAQ && historicalData['QQQ']) {
      const qqqRet = calculateReturns(historicalData['QQQ'], days);
      datasets.push({ label: 'NASDAQ (QQQ)', data: qqqRet.map(d=>d.returnPct), borderColor: '#8c79a8', backgroundColor: 'transparent', borderDash: [2, 2], tension: 0.2, borderWidth: 1.5, pointRadius: 0 });
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
    try {
        const response = await fetch(`/api/history?symbols=${fetchSymbols.join(',')}`);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to fetch history');
        }
        historicalData = await response.json();
    } catch (e) {
        console.warn("Could not load historical data:", e.message);
    }
}

async function renderPortfolio(csvText) {
  const importedRows = parseCSV(csvText);
  if (!importedRows.length) throw new Error('ไฟล์ CSV ไม่มีรายการที่อ่านได้');

  rows = importedRows;
  const portfolio = aggregate(rows);
  updateText(portfolio);
  renderCharts(portfolio);
  renderTable(portfolio);

  document.querySelector('#rowStatus').textContent = 'กำลังโหลดข้อมูลย้อนหลัง...';
  await fetchHistoricalData(portfolio.map(item => item.symbol));
  renderHistoryChart();

  const latest = new Date();
  document.querySelector('#updatedAt').textContent = `อัปเดต ${latest.toLocaleDateString('th-TH')} ${latest.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
}

async function loadDashboard() {
  try { 
      const savedCSV = localStorage.getItem(CSV_STORAGE_KEY);
      let csvText = savedCSV;
      if (!csvText) {
        const response = await fetch(DATA_FILE);
        if (!response.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ');
        csvText = await response.text();
      }
      await renderPortfolio(csvText);
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
    localStorage.setItem(CSV_STORAGE_KEY, csvText);
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
document.querySelector('#reloadButton').addEventListener('click', loadDashboard);

loadDashboard();
