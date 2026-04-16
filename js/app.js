/* =========================================================
   Vermont Population Projections – app.js
   ========================================================= */

'use strict';

// ── State ────────────────────────────────────────────────
const state = {
  county: { scenario: 'A', year: '2020', display: 'pct' },
  town:   { scenario: 'A', year: '2020', display: 'pct' },
};

// ── Data stores ──────────────────────────────────────────
const countyData = {};   // { A: [...rows], B: [...rows] }
const townData   = {};
let countyGeoJSON = null;
let townGeoJSON   = null;

// ── Leaflet instances ────────────────────────────────────
let countyMap   = null;
let countyLayer = null;
let countyLegend = null;
let townMap     = null;
let townLayer   = null;
let townLegend  = null;

// ── Chart.js instance ────────────────────────────────────
let countyChart      = null;
let currentCountyName = null;   // tracks which county panel is open

// ── Age cohort order & colors ────────────────────────────
const AGE_GROUPS = [
  '<5','5-9','10-14','15-19','20-24','25-29',
  '30-34','35-39','40-44','45-49','50-54','55-59',
  '60-64','65-69','70-74','75-79','80-84','85+'
];

const AGE_COLORS = [
  '#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4',
  '#42d4f4','#f032e6','#bfef45','#fabed4','#469990','#dcbeff',
  '#9a6324','#808000','#800000','#aaffc3','#ffd8b1','#a9a9a9'
];

// ── Color scales (chroma.js) ─────────────────────────────
// Diverging % change: red (decline) → pale (neutral) → green (growth)
const COUNTY_PCT_SCALE = chroma.scale([
  '#d73027','#f46d43','#fdae61','#ffffbf','#d9ef8b','#a6d96a','#1a9641'
]).domain([-15, 0, 15]);

const TOWN_PCT_SCALE = chroma.scale([
  '#d73027','#f46d43','#fdae61','#ffffbf','#d9ef8b','#a6d96a','#1a9641'
]).domain([-20, 0, 60]);

// Sequential population count: light tint → UVM green → forest green
// County total populations range roughly 5k (Essex) to 160k (Chittenden)
const COUNTY_COUNT_SCALE = chroma.scale(['#eaf3ee','#4aad6e','#007A33','#154734'])
  .domain([0, 160000]);

// Town populations range from tiny (< 100) to ~45k (Burlington)
const TOWN_COUNT_SCALE = chroma.scale(['#eaf3ee','#4aad6e','#007A33','#154734'])
  .domain([0, 45000]);

// ── GeoJSON paths ────────────────────────────────────────
const COUNTY_GEOJSON = 'data/FS_VCGI_OPENDATA_Boundary_BNDHASH_poly_counties_SP_v1_-911660585983419871.geojson';
const TOWN_GEOJSON   = 'data/FS_VCGI_OPENDATA_Boundary_BNDHASH_poly_towns_SP_v1_-669012076166787740.geojson';

// ── Vermont map centre / zoom ─────────────────────────────
const VT_CENTER = [44.0, -72.68];
const VT_ZOOM   = 7;

// =========================================================
// DATA LOADING
// =========================================================

function loadCSV(path) {
  return new Promise((resolve, reject) => {
    Papa.parse(path, {
      download:     true,
      header:       true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: results => resolve(results.data),
      error:    err    => reject(err),
    });
  });
}

async function loadAllData() {
  const [cA, cB, tA, tB, cGJ, tGJ] = await Promise.all([
    loadCSV('data/county_projections_a.csv'),
    loadCSV('data/county_projections_b.csv'),
    loadCSV('data/town_projections_a.csv'),
    loadCSV('data/town_projections_b.csv'),
    fetch(COUNTY_GEOJSON).then(r => r.json()),
    fetch(TOWN_GEOJSON).then(r => r.json()),
  ]);

  countyData.A = cA.filter(r => r.county && r.county !== 'VERMONT');
  countyData.B = cB.filter(r => r.county && r.county !== 'VERMONT');
  townData.A   = tA.filter(r => r.town);
  townData.B   = tB.filter(r => r.town);
  countyGeoJSON = cGJ;
  townGeoJSON   = tGJ;
}

// =========================================================
// LOOKUP HELPERS
// =========================================================

function getCountyTotalRow(countyName, scenario) {
  return (countyData[scenario] || []).find(
    r => r.county === countyName && r.age_group === 'Total'
  ) || null;
}

function getCountyPctChange(countyName, scenario, year) {
  const row = getCountyTotalRow(countyName, scenario);
  if (!row) return null;
  return year === '2020' ? row.pct_change_2020 : row.pct_change_2030;
}

function getTownRow(townName, scenario) {
  return (townData[scenario] || []).find(r => r.town === townName) || null;
}

function getTownPctChange(townName, scenario, year) {
  const row = getTownRow(townName, scenario);
  if (!row) return null;
  return year === '2020' ? row.pct_change_2020 : row.pct_change_2030;
}

function getCountyCount(countyName, scenario, year) {
  const row = getCountyTotalRow(countyName, scenario);
  if (!row) return null;
  return year === '2020' ? row.proj_2020 : row.proj_2030;
}

function getTownCount(townName, scenario, year) {
  const row = getTownRow(townName, scenario);
  if (!row) return null;
  return year === '2020' ? row.proj_2020 : row.proj_2030;
}

function formatPct(val) {
  if (val === null || val === undefined) return '–';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val}%`;
}

function pctClass(val) {
  if (val === null || val === undefined) return '';
  return val > 0 ? 'pct-pos' : val < 0 ? 'pct-neg' : '';
}

// =========================================================
// COUNTY MAP
// =========================================================

function initCountyMap() {
  countyMap = L.map('county-map', { zoomControl: true, minZoom: 7 }).setView(VT_CENTER, VT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    opacity: 0.35,
  }).addTo(countyMap);

  renderCountyLayer();
}

function renderCountyLayer() {
  if (countyLayer) countyMap.removeLayer(countyLayer);

  const { scenario, year, display } = state.county;

  countyLayer = L.geoJSON(countyGeoJSON, {
    style: feature => {
      const name = feature.properties.CNTYNAME;
      let color = '#cccccc';
      if (display === 'pct') {
        const pct = getCountyPctChange(name, scenario, year);
        if (pct !== null && pct !== undefined) color = COUNTY_PCT_SCALE(pct).hex();
      } else {
        const count = getCountyCount(name, scenario, year);
        if (count !== null && count !== undefined) color = COUNTY_COUNT_SCALE(count).hex();
      }
      return { fillColor: color, fillOpacity: 0.78, color: '#555', weight: 1.5 };
    },
    onEachFeature: (feature, layer) => {
      const name = feature.properties.CNTYNAME;
      layer.on({
        mouseover: e => {
          layer.setStyle({ weight: 3, color: '#222', fillOpacity: 0.9 });
          layer.bringToFront();
          showCountyTooltip(e, name);
        },
        mouseout: () => {
          countyLayer.resetStyle(layer);
          countyMap.closePopup();
        },
        click: () => openCountyPanel(name),
      });
    },
  }).addTo(countyMap);

  renderCountyLegend();
}

function showCountyTooltip(e, countyName) {
  const { scenario, year, display } = state.county;
  const displayName = toTitleCase(countyName) + ' County';
  let label;

  if (display === 'pct') {
    const pct = getCountyPctChange(countyName, scenario, year);
    label = (pct !== null && pct !== undefined)
      ? `% change (${year}): <span class="${pctClass(pct)}">${formatPct(pct)}</span>`
      : '<span style="color:#999">No data</span>';
  } else {
    const count = getCountyCount(countyName, scenario, year);
    label = (count !== null && count !== undefined)
      ? `Population (${year}): <strong>${Number(count).toLocaleString()}</strong>`
      : '<span style="color:#999">No data</span>';
  }

  L.popup({ closeButton: false, autoPan: false, className: 'hover-popup' })
    .setLatLng(e.latlng)
    .setContent(`<strong>${displayName}</strong><br>${label}`)
    .openOn(countyMap);
}

function renderCountyLegend() {
  if (countyLegend) countyLegend.remove();

  countyLegend = L.control({ position: 'bottomright' });
  countyLegend.onAdd = () => {
    const div = L.DomUtil.create('div', 'legend');
    const { year, display } = state.county;

    if (display === 'pct') {
      const stops  = [-15, -10, -5, 0, 5, 10, 15];
      const labels = ['≤ -15%', '-10%', '-5%', '0%', '+5%', '+10%', '≥ +15%'];
      div.innerHTML = `<div class="legend-title">% Change (${year})</div>`;
      stops.forEach((val, i) => {
        div.innerHTML += `<div class="legend-item">
          <span class="legend-swatch" style="background:${COUNTY_PCT_SCALE(val).hex()}"></span>
          <span>${labels[i]}</span></div>`;
      });
    } else {
      const stops  = [0, 20000, 40000, 80000, 120000, 160000];
      const labels = ['0', '20k', '40k', '80k', '120k', '160k+'];
      div.innerHTML = `<div class="legend-title">Population (${year})</div>`;
      stops.forEach((val, i) => {
        div.innerHTML += `<div class="legend-item">
          <span class="legend-swatch" style="background:${COUNTY_COUNT_SCALE(val).hex()}"></span>
          <span>${labels[i]}</span></div>`;
      });
    }

    div.innerHTML += `<div class="legend-no-data">
      <span class="legend-swatch" style="background:#cccccc"></span>
      <span>No data</span></div>`;
    return div;
  };
  countyLegend.addTo(countyMap);
}

// =========================================================
// COUNTY PANEL
// =========================================================

function openCountyPanel(countyName) {
  currentCountyName = countyName;
  const panel = document.getElementById('county-panel');
  const emptyState = document.getElementById('county-empty-state');
  if (emptyState) emptyState.style.display = 'none';

  document.getElementById('panel-title').textContent =
    toTitleCase(countyName) + ' County';

  panel.classList.remove('hidden');

  // Default to chart view
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.view-btn[data-view="chart"]').classList.add('active');
  document.getElementById('panel-chart-container').classList.remove('hidden');
  document.getElementById('panel-table-container').classList.add('hidden');

  renderCountyChart(countyName);
  renderCountyTable(countyName);
}

function renderCountyChart(countyName) {
  const { scenario } = state.county;
  const rows = (countyData[scenario] || []).filter(
    r => r.county === countyName && r.age_group !== 'Total'
  );

  // Sort youngest → oldest
  rows.sort((a, b) => AGE_GROUPS.indexOf(a.age_group) - AGE_GROUPS.indexOf(b.age_group));

  // Pre-calculate % share of total population for each year
  const yearKeys = ['census_2010', 'proj_2020', 'proj_2030'];
  const totals = yearKeys.map(k => rows.reduce((s, r) => s + r[k], 0));

  // Reverse so oldest is drawn first (bottom of stack), youngest last (top)
  const orderedRows = [...rows].reverse();

  const datasets = orderedRows.map((row, i) => {
    const origIdx = rows.length - 1 - i;   // colour index matching original order
    const pcts = yearKeys.map((k, yi) =>
      totals[yi] > 0 ? parseFloat(((row[k] / totals[yi]) * 100).toFixed(2)) : 0
    );
    const hex = AGE_COLORS[origIdx % AGE_COLORS.length];
    return {
      label:           row.age_group,
      data:            pcts,
      fill:            true,
      backgroundColor: hex + 'cc',   // slight transparency so borders show
      borderColor:     hex,
      borderWidth:     0.5,
      tension:         0.3,
      pointRadius:     3,
      pointHoverRadius: 5,
    };
  });

  if (countyChart) countyChart.destroy();

  const ctx = document.getElementById('county-chart').getContext('2d');
  countyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['2010', '2020', '2030'],
      datasets,
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: 300 },
      plugins: {
        legend: {
          position: 'right',
          // Reverse legend so youngest appears at top (matching visual stack)
          reverse: true,
          labels: {
            boxWidth:      10,
            font:          { size: 10 },
            padding:       5,
            usePointStyle: true,
          },
        },
        tooltip: {
          mode: 'index',
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
        title: {
          display: true,
          text:    `${toTitleCase(countyName)} County — Age Distribution (Scenario ${scenario})`,
          font:    { size: 12 },
          padding: { bottom: 8 },
          color:   '#333',
        },
      },
      scales: {
        x: {
          title:   { display: true, text: 'Year', font: { size: 11 } },
          stacked: true,
        },
        y: {
          stacked: true,
          min:     0,
          max:     100,
          title:   { display: true, text: '% of Population', font: { size: 11 } },
          ticks:   { callback: v => `${v}%`, font: { size: 10 } },
        },
      },
    },
  });
}

function renderCountyTable(countyName) {
  const { scenario } = state.county;
  const rows = (countyData[scenario] || []).filter(r => r.county === countyName);
  rows.sort((a, b) => {
    const ai = AGE_GROUPS.indexOf(a.age_group);
    const bi = AGE_GROUPS.indexOf(b.age_group);
    if (ai === -1 && a.age_group === 'Total') return 1;
    if (bi === -1 && b.age_group === 'Total') return -1;
    return ai - bi;
  });

  const tbody = document.querySelector('#county-table tbody');
  tbody.innerHTML = '';

  rows.forEach(row => {
    const tr = document.createElement('tr');
    const p20 = formatPct(row.pct_change_2020);
    const p30 = formatPct(row.pct_change_2030);
    const c20 = pctClass(row.pct_change_2020);
    const c30 = pctClass(row.pct_change_2030);
    tr.innerHTML = `
      <td>${row.age_group}</td>
      <td>${Number(row.census_2010).toLocaleString()}</td>
      <td>${Number(row.proj_2020).toLocaleString()}</td>
      <td class="${c20}">${p20}</td>
      <td>${Number(row.proj_2030).toLocaleString()}</td>
      <td class="${c30}">${p30}</td>
    `;
    tbody.appendChild(tr);
  });
}

// =========================================================
// TOWN MAP
// =========================================================

function initTownMap() {
  townMap = L.map('town-map', { zoomControl: true, minZoom: 7 }).setView(VT_CENTER, VT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    opacity: 0.35,
  }).addTo(townMap);

  renderTownLayer();
}

function renderTownLayer() {
  if (townLayer) townMap.removeLayer(townLayer);

  const { scenario, year, display } = state.town;

  townLayer = L.geoJSON(townGeoJSON, {
    style: feature => {
      const name = feature.properties.TOWNNAME;
      let color = '#cccccc';
      if (display === 'pct') {
        const pct = getTownPctChange(name, scenario, year);
        if (pct !== null && pct !== undefined) color = TOWN_PCT_SCALE(pct).hex();
      } else {
        const count = getTownCount(name, scenario, year);
        if (count !== null && count !== undefined) color = TOWN_COUNT_SCALE(count).hex();
      }
      return { fillColor: color, fillOpacity: 0.78, color: '#777', weight: 0.5 };
    },
    onEachFeature: (feature, layer) => {
      const name = feature.properties.TOWNNAME;
      const displayName = feature.properties.TOWNNAMEMC || toTitleCase(name);
      layer.on({
        mouseover: e => {
          layer.setStyle({ weight: 2, color: '#222', fillOpacity: 0.92 });
          layer.bringToFront();
        },
        mouseout: () => {
          townLayer.resetStyle(layer);
        },
        click: e => openTownPopup(e, name, displayName),
      });
    },
  }).addTo(townMap);

  renderTownLegend();
}

function openTownPopup(e, townName, displayName) {
  const { scenario } = state.town;
  const row = getTownRow(townName, scenario);

  if (!row) {
    L.popup({ maxWidth: 220 })
      .setLatLng(e.latlng)
      .setContent(`<strong>${displayName}</strong><br><em style="color:#999">No projection data</em>`)
      .openOn(townMap);
    return;
  }

  const fmt = n => Number(n).toLocaleString();
  const p20 = formatPct(row.pct_change_2020);
  const p30 = formatPct(row.pct_change_2030);
  const c20 = pctClass(row.pct_change_2020);
  const c30 = pctClass(row.pct_change_2030);
  const countyDisplay = toTitleCase(row.county) + ' County';

  L.popup({ maxWidth: 240 })
    .setLatLng(e.latlng)
    .setContent(`
      <strong>${displayName}</strong>
      <div class="popup-county">${countyDisplay}</div>
      <table class="popup-table">
        <tr>
          <td>2010 Census</td>
          <td>${fmt(row.census_2010)}</td>
        </tr>
        <tr>
          <td>2020 Projection</td>
          <td>${fmt(row.proj_2020)}</td>
        </tr>
        <tr>
          <td>2020 % change</td>
          <td class="${c20}">${p20}</td>
        </tr>
        <tr>
          <td>2030 Projection</td>
          <td>${fmt(row.proj_2030)}</td>
        </tr>
        <tr>
          <td>2030 % change</td>
          <td class="${c30}">${p30}</td>
        </tr>
      </table>
    `)
    .openOn(townMap);
}

function renderTownLegend() {
  if (townLegend) townLegend.remove();

  townLegend = L.control({ position: 'bottomright' });
  townLegend.onAdd = () => {
    const div = L.DomUtil.create('div', 'legend');
    const { year, display } = state.town;

    if (display === 'pct') {
      const stops  = [-20, -10, 0, 15, 30, 60];
      const labels = ['≤ -20%', '-10%', '0%', '+15%', '+30%', '≥ +60%'];
      div.innerHTML = `<div class="legend-title">% Change (${year})</div>`;
      stops.forEach((val, i) => {
        div.innerHTML += `<div class="legend-item">
          <span class="legend-swatch" style="background:${TOWN_PCT_SCALE(val).hex()}"></span>
          <span>${labels[i]}</span></div>`;
      });
    } else {
      const stops  = [0, 2500, 5000, 10000, 20000, 45000];
      const labels = ['0', '2.5k', '5k', '10k', '20k', '45k+'];
      div.innerHTML = `<div class="legend-title">Population (${year})</div>`;
      stops.forEach((val, i) => {
        div.innerHTML += `<div class="legend-item">
          <span class="legend-swatch" style="background:${TOWN_COUNT_SCALE(val).hex()}"></span>
          <span>${labels[i]}</span></div>`;
      });
    }

    div.innerHTML += `<div class="legend-no-data">
      <span class="legend-swatch" style="background:#cccccc"></span>
      <span>No data</span></div>`;
    return div;
  };
  townLegend.addTo(townMap);
}

// =========================================================
// TOGGLE BUTTONS
// =========================================================

function initToggleButtons() {
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { target, key, value } = btn.dataset;

      // Deactivate siblings with same target + key
      document.querySelectorAll(
        `.toggle-btn[data-target="${target}"][data-key="${key}"]`
      ).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state[target][key] = value;

      if (target === 'county') {
        renderCountyLayer();
        if (currentCountyName) {
          renderCountyChart(currentCountyName);
          renderCountyTable(currentCountyName);
        }
      } else {
        renderTownLayer();
      }
    });
  });
}

function initPanelControls() {
  // Close button
  document.getElementById('close-panel').addEventListener('click', () => {
    document.getElementById('county-panel').classList.add('hidden');
    currentCountyName = null;
    if (countyChart) {
      countyChart.destroy();
      countyChart = null;
    }
  });

  // Chart / Table toggle inside panel
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.getElementById('panel-chart-container')
        .classList.toggle('hidden', view !== 'chart');
      document.getElementById('panel-table-container')
        .classList.toggle('hidden', view !== 'table');
    });
  });
}

// =========================================================
// UTILITY
// =========================================================

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// =========================================================
// ENTRY POINT
// =========================================================

// =========================================================
// SUMMARY SECTION
// =========================================================

function buildSummary() {
  // Use Scenario A 2030 as the primary summary lens
  const cRows = countyData.A.filter(r => r.age_group === 'Total');
  const tRows = townData.A;

  // Vermont totals from VT row (we filter it out of countyData but it's in the raw CSV)
  // Reconstruct from sum of counties
  const census2010 = cRows.reduce((s, r) => s + r.census_2010, 0);
  const proj2020   = cRows.reduce((s, r) => s + r.proj_2020,   0);
  const proj2030   = cRows.reduce((s, r) => s + r.proj_2030,   0);
  const pct2020    = ((proj2020 - census2010) / census2010 * 100).toFixed(1);
  const pct2030    = ((proj2030 - census2010) / census2010 * 100).toFixed(1);

  // Stat cards
  const stats = [
    { label: '2010 Census', value: census2010.toLocaleString(), sub: 'Vermont total' },
    { label: '2020 Projection (A)', value: proj2020.toLocaleString(), sub: `${pct2020 > 0 ? '+' : ''}${pct2020}% from 2010`, pos: pct2020 >= 0 },
    { label: '2030 Projection (A)', value: proj2030.toLocaleString(), sub: `${pct2030 > 0 ? '+' : ''}${pct2030}% from 2010`, pos: pct2030 >= 0 },
    { label: 'Counties Projected to Grow', value: cRows.filter(r => r.pct_change_2030 > 0).length, sub: 'by 2030, Scenario A' },
    { label: 'Towns Projected to Grow', value: tRows.filter(r => r.pct_change_2030 > 0).length, sub: 'by 2030, Scenario A' },
    { label: 'Fastest Growing Age Group', value: getFastestAgeGroup(), sub: 'statewide 2010–2030, Scenario A' },
  ];

  const grid = document.getElementById('summary-stats');
  grid.innerHTML = stats.map(s => `
    <div class="summary-stat">
      <div class="summary-stat-value">${s.value}</div>
      <div class="summary-stat-label">${s.label}</div>
      <div class="summary-stat-sub ${s.pos === true ? 'pct-pos' : s.pos === false ? 'pct-neg' : ''}">${s.sub}</div>
    </div>`).join('');

  // County top/bottom tables
  const sortedCounties = [...cRows].sort((a, b) => b.pct_change_2030 - a.pct_change_2030);
  fillRankTable('tbl-county-growth',  sortedCounties.slice(0, 5),  'county');
  fillRankTable('tbl-county-decline', sortedCounties.slice(-5).reverse(), 'county');

  // Town top/bottom tables (filter out tiny populations to avoid noise)
  const sortedTowns = [...tRows]
    .filter(r => r.census_2010 >= 500)
    .sort((a, b) => b.pct_change_2030 - a.pct_change_2030);
  fillRankTable('tbl-town-growth',  sortedTowns.slice(0, 5),  'town');
  fillRankTable('tbl-town-decline', sortedTowns.slice(-5).reverse(), 'town');
}

function getFastestAgeGroup() {
  // Sum each age group across all counties for 2030
  const grouped = {};
  countyData.A.filter(r => r.age_group !== 'Total').forEach(r => {
    if (!grouped[r.age_group]) grouped[r.age_group] = { c2010: 0, c2030: 0 };
    grouped[r.age_group].c2010 += r.census_2010;
    grouped[r.age_group].c2030 += r.proj_2030;
  });
  let best = null, bestPct = -Infinity;
  Object.entries(grouped).forEach(([ag, v]) => {
    const pct = (v.c2030 - v.c2010) / v.c2010 * 100;
    if (pct > bestPct) { bestPct = pct; best = ag; }
  });
  return best ? `${best} (${bestPct > 0 ? '+' : ''}${bestPct.toFixed(1)}%)` : '–';
}

function fillRankTable(id, rows, nameKey) {
  const tbl = document.getElementById(id);
  tbl.innerHTML = `
    <thead><tr>
      <th>${nameKey === 'county' ? 'County' : 'Town'}</th>
      <th>2010</th><th>2030</th><th>% Change</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${toTitleCase(r[nameKey])}${nameKey === 'county' ? ' Co.' : ''}</td>
      <td>${Number(r.census_2010).toLocaleString()}</td>
      <td>${Number(r.proj_2030).toLocaleString()}</td>
      <td class="${pctClass(r.pct_change_2030)}">${formatPct(r.pct_change_2030)}</td>
    </tr>`).join('')}</tbody>`;
}

// =========================================================
// ENTRY POINT
// =========================================================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadAllData();
    initCountyMap();
    initTownMap();
    initToggleButtons();
    initPanelControls();
    buildSummary();
  } catch (err) {
    console.error('Failed to load data:', err);
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="padding:1rem;background:#fee;color:#900;font-family:sans-serif">
        <strong>Error loading data.</strong> Please serve this from a local HTTP server
        (e.g. <code>python -m http.server 8080</code>).
        <br><small>${err.message}</small>
      </div>`
    );
  }
});
