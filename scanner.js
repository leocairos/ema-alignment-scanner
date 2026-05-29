require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { EMA, RSI, MFI, ADX, ATR } = require('technicalindicators');

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';
const CMC_API_BASE = 'https://pro-api.coinmarketcap.com/v1';

const { CMC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

if (!CMC_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("CRITICAL ERROR: Missing API Keys in .env file.");
  process.exit(1);
}

// --- CONFIGURATION PERSISTENCE & STATE ---

const CONFIG_FILE = path.join(__dirname, 'config.json');
let CONFIG = {};

// Global state to track last cycle's execution metrics
let lastCycleStats = {
  uniqueAlertedPairs: 0,
  startTime: 'N/A',
  endTime: 'N/A',
  duration: 'N/A'
};

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const rawData = fs.readFileSync(CONFIG_FILE, 'utf8');
      CONFIG = JSON.parse(rawData);
      console.log("Loaded configuration from config.json");
      return;
    } catch (err) {
      console.warn("Failed to parse config.json, falling back to .env", err.message);
    }
  }

  CONFIG = {
    exclude: (process.env.EXCLUDE_ASSETS || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    minCap: parseFloat(process.env.MIN_MARKET_CAP) || 0,
    minVol: parseFloat(process.env.MIN_24H_VOL) || 0,
    timeframes: (process.env.TIMEFRAMES || '1h,4h,1d').split(',').map(s => s.trim()).filter(Boolean)
  };
  saveConfig();
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 4), 'utf8');
  } catch (err) {
    console.error("Error saving config.json:", err.message);
  }
}

loadConfig();

const CANDLE_LIMIT = 200;
const LOOP_DELAY_MS = 15 * 60 * 1000;

// --- TELEGRAM NATIVE FETCH IMPLEMENTATION ---

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (err) {
    console.error(`Telegram Message Error: ${err.message}`);
  }
}

async function sendTelegramReport(matches, stats) {
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Crypto Alignment Report</title>
        <link rel="stylesheet" href="https://cdn.datatables.net/1.13.6/css/jquery.dataTables.min.css">
        <style>
            body { font-family: Arial, sans-serif; padding: 20px; background-color: #f4f7f6; font-size: 14px; }
            h2 { color: #333; margin-bottom: 5px; }
            .filters-banner { background: #e2e8f0; padding: 10px 15px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; color: #334155; border-left: 4px solid #3b82f6; display: flex; flex-direction: column; gap: 5px; }
            .container { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); overflow-x: auto; }
            a { color: #2962FF; text-decoration: none; font-weight: bold; }
            a:hover { text-decoration: underline; }
            table.dataTable tbody td { padding: 8px 10px; }
            .hint { font-size: 12px; color: #666; margin-bottom: 15px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Crypto Alignment Scanner - ${new Date().toLocaleString()}</h2>
            <div class="filters-banner">
                <div><b>Active Filters:</b> 
                    Min 24h Vol: $${formatNum(CONFIG.minVol)} | 
                    Min Market Cap: $${formatNum(CONFIG.minCap)} | 
                    Timeframes: ${CONFIG.timeframes.join(', ')} |
                    Excluded: ${CONFIG.exclude.length > 0 ? CONFIG.exclude.join(', ') : 'None'}
                </div>
                <div><b>Cycle Stats:</b> 
                    Start: ${stats.startTime} | 
                    End: ${stats.endTime} | 
                    Duration: ${stats.duration} | 
                    <b>Unique Alerted Pairs: ${stats.uniqueAlertedPairs}</b>
                </div>
            </div>
            <p class="hint"><b>Pro-Tip:</b> Open the chart link, press <b>Alt + G</b> on TradingView, and paste the <i>Alert Time</i> to jump directly to the setup.</p>
            <table id="reportTable" class="display nowrap" style="width:100%">
                <thead>
                    <tr>
                        <th>Symbol</th>
                        <th>Alert Time</th>
                        <th>TF</th>
                        <th>Status</th>
                        <th>Price</th>
                        <th>Prc % EMA8</th>
                        <th>TF Vol</th>
                        <th>Vol % EMA</th>
                        <th>EMA Vol(14)</th>
                        <th>24h Vol</th>
                        <th>Market Cap</th>
                        <th>EMA8</th>
                        <th>EMA21</th>
                        <th>EMA50</th>
                        <th>RSI</th>
                        <th>MFI</th>
                        <th>ADX</th>
                        <th>ATR</th>
                        <th>ATR %</th>
                    </tr>
                </thead>
                <tbody>
                    ${matches.map(m => `
                    <tr>
                        <td><a href="${m.tvLink}" target="_blank">${m.symbol}</a></td>
                        <td data-order="${m.rawTimestamp}">${m.alertTime}</td>
                        <td data-order="${m.rawTimeframe}">${m.timeframe}</td>
                        <td><b>${m.status}</b></td>
                        <td>$${m.price}</td>
                        <td data-order="${m.rawPrcEma8Pct}">${m.prcEma8Pct}%</td>
                        <td data-order="${m.rawTfVol}">$${m.tfVol}</td>
                        <td data-order="${m.rawVolEmaPct}">${m.volEmaPct}%</td>
                        <td data-order="${m.rawEmaVol}">$${m.emaVol}</td>
                        <td data-order="${m.rawVol24h}">$${m.vol24h}</td>
                        <td data-order="${m.rawMarketCap}">$${m.marketCap}</td>
                        <td>${m.ema8}</td>
                        <td>${m.ema21}</td>
                        <td>${m.ema50}</td>
                        <td>${m.rsi}</td>
                        <td>${m.mfi}</td>
                        <td>${m.adx}</td>
                        <td>${m.atr}</td>
                        <td data-order="${m.rawAtrPct}">${m.atrPct}%</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        <script src="https://cdn.datatables.net/1.13.6/js/jquery.dataTables.min.js"></script>
        <script> 
            $(document).ready(function() { 
                $('#reportTable').DataTable({ 
                    "order": [[ 9, "desc" ]], // Index 9 is now '24h Vol' after reordering
                    "scrollX": true
                }); 
            }); 
        </script>
    </body>
    </html>`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
  try {
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('caption', `📊 Scan completed. Found ${matches.length} alerts across ${stats.uniqueAlertedPairs} unique pairs.`);
    const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
    formData.append('document', htmlBlob, 'scanner_report.html');

    await fetch(url, { method: 'POST', body: formData });
  } catch (err) {
    console.error(`Telegram Document Error: ${err.message}`);
  }
}

// --- TELEGRAM MANUAL LONG POLLING & MENUS ---

function getHelpMenu() {
  return `🤖 <b>Scanner Bot Operations Menu</b>\n\n` +
    `Control your strategy in real-time:\n\n` +
    `🔸 <b>/params</b> - View current config & last scan stats\n` +
    `🔸 <b>/set_exclude [assets]</b> - e.g., /set_exclude USDC, EUR\n` +
    `🔸 <b>/set_cap [number]</b> - Min Market Cap (e.g., /set_cap 50000000)\n` +
    `🔸 <b>/set_vol [number]</b> - Min 24h Vol (e.g., /set_vol 1000000)\n` +
    `🔸 <b>/set_tf [TFs]</b> - e.g., /set_tf 15m, 1h, 4h\n` +
    `🔸 <b>/help</b> or <b>/start</b> - Show this menu`;
}

async function sendWelcomeMessage() {
  const msg = `✅ <b>Bot Initialized Successfully!</b>\n\n${getHelpMenu()}\n\n⏳ <i>Starting the first market scan now...</i>`;
  await sendTelegramMessage(msg);
}

let lastUpdateId = 0;

async function pollTelegram() {
  while (true) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
      const data = await res.json();

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;

          if (update.message && update.message.text) {
            handleTelegramCommand(update.message);
          }
        }
      }
    } catch (e) {
      await sleep(2000);
    }
  }
}

function handleTelegramCommand(msg) {
  const chatId = msg.chat.id.toString();
  if (chatId !== TELEGRAM_CHAT_ID) return;

  const text = msg.text.trim();

  if (text === '/help' || text === '/start') {
    sendTelegramMessage(getHelpMenu());
  }
  else if (text === '/params') {
    const resp = `⚙️ <b>Current Configuration</b>\n\n` +
      `🚫 <b>Exclude:</b> ${CONFIG.exclude.join(', ') || 'None'}\n` +
      `💰 <b>Min Cap:</b> $${formatNum(CONFIG.minCap)}\n` +
      `📊 <b>Min 24h Vol:</b> $${formatNum(CONFIG.minVol)}\n` +
      `⏳ <b>Timeframes:</b> ${CONFIG.timeframes.join(', ')}\n\n` +
      `⏱️ <b>Last Scan Stats:</b>\n` +
      `▫️ <b>Start:</b> ${lastCycleStats.startTime}\n` +
      `▫️ <b>End:</b> ${lastCycleStats.endTime}\n` +
      `▫️ <b>Duration:</b> ${lastCycleStats.duration}\n` +
      `📡 <b>Unique Alerted Pairs:</b> ${lastCycleStats.uniqueAlertedPairs}`;
    sendTelegramMessage(resp);
  }
  else if (text.startsWith('/set_exclude ')) {
    const value = text.replace('/set_exclude ', '');
    CONFIG.exclude = value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    saveConfig();
    sendTelegramMessage(`✅ Exclude list saved: ${CONFIG.exclude.join(', ')}`);
  }
  else if (text.startsWith('/set_cap ')) {
    const val = parseFloat(text.replace('/set_cap ', ''));
    if (isNaN(val)) return sendTelegramMessage("❌ Invalid number.");
    CONFIG.minCap = val;
    saveConfig();
    sendTelegramMessage(`✅ Min Market Cap saved: $${formatNum(CONFIG.minCap)}`);
  }
  else if (text.startsWith('/set_vol ')) {
    const val = parseFloat(text.replace('/set_vol ', ''));
    if (isNaN(val)) return sendTelegramMessage("❌ Invalid number.");
    CONFIG.minVol = val;
    saveConfig();
    sendTelegramMessage(`✅ Min 24h Vol saved: $${formatNum(CONFIG.minVol)}`);
  }
  else if (text.startsWith('/set_tf ')) {
    const value = text.replace('/set_tf ', '');
    CONFIG.timeframes = value.split(',').map(s => s.trim()).filter(Boolean);
    saveConfig();
    sendTelegramMessage(`✅ Timeframes saved: ${CONFIG.timeframes.join(', ')}`);
  }
}

// --- UTILS ---

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatNum(num) {
  if (!num || num === 0) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

function formatAlertTime(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + "m " + (seconds < 10 ? '0' : '') + seconds + "s";
}

function getTvInterval(timeframe) {
  const map = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
    '1h': '60', '2h': '120', '4h': '240', '6h': '360', '8h': '480', '12h': '720',
    '1d': 'D', '3d': '3D', '1w': 'W', '1M': 'M'
  };
  return map[timeframe] || 'D';
}

function getTfWeight(timeframe) {
  const value = parseInt(timeframe);
  if (timeframe.includes('m')) return value;
  if (timeframe.includes('h')) return value * 60;
  if (timeframe.includes('d')) return value * 60 * 24;
  return 999999;
}

function generateTvLink(symbol, timeframe) {
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}&interval=${getTvInterval(timeframe)}`;
}

// --- CORE LOGIC ---

async function fetchUsdtPairs() {
  const response = await fetch(`${BINANCE_API_BASE}/exchangeInfo`);
  const data = await response.json();
  return data.symbols
    .filter(sym => sym.quoteAsset === 'USDT' && sym.status === 'TRADING')
    .map(sym => sym.symbol)
    .filter(symbol => {
      const baseAsset = symbol.replace('USDT', '');
      return !CONFIG.exclude.includes(baseAsset);
    });
}

async function fetchBinanceTickers() {
  const response = await fetch(`${BINANCE_API_BASE}/ticker/24hr`);
  const data = await response.json();
  const tickerMap = new Map();
  data.forEach(ticker => {
    if (ticker.symbol.endsWith('USDT')) {
      tickerMap.set(ticker.symbol, {
        price: parseFloat(ticker.lastPrice),
        vol24h: parseFloat(ticker.quoteVolume)
      });
    }
  });
  return tickerMap;
}

async function fetchMarketCaps(symbols) {
  const baseAssets = symbols.map(s => s.replace('USDT', ''));
  const marketCapMap = new Map();
  for (let i = 0; i < baseAssets.length; i += 100) {
    const chunk = baseAssets.slice(i, i + 100).join(',');
    try {
      const response = await fetch(`${CMC_API_BASE}/cryptocurrency/quotes/latest?symbol=${chunk}`, { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } });
      const json = await response.json();
      if (json.data) {
        Object.keys(json.data).forEach(coin => marketCapMap.set(`${coin}USDT`, json.data[coin].quote?.USD?.market_cap || 0));
      }
      await sleep(1000);
    } catch (error) { }
  }
  return marketCapMap;
}

async function fetchKlines(symbol, interval) {
  const response = await fetch(`${BINANCE_API_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${CANDLE_LIMIT}`);
  const klines = await response.json();
  return {
    high: klines.map(k => parseFloat(k[2])),
    low: klines.map(k => parseFloat(k[3])),
    close: klines.map(k => parseFloat(k[4])),
    volume: klines.map(k => parseFloat(k[5])),
    quoteVolume: klines.map(k => parseFloat(k[7]))
  };
}

function calculateIndicators(data) {
  const ema8 = EMA.calculate({ period: 8, values: data.close });
  const ema21 = EMA.calculate({ period: 21, values: data.close });
  const ema50 = EMA.calculate({ period: 50, values: data.close });
  const ema100 = EMA.calculate({ period: 100, values: data.close });
  const rsi = RSI.calculate({ period: 14, values: data.close });
  const adx = ADX.calculate({ high: data.high, low: data.low, close: data.close, period: 14 });
  const atr = ATR.calculate({ high: data.high, low: data.low, close: data.close, period: 14 });
  const mfi = MFI.calculate({ high: data.high, low: data.low, close: data.close, volume: data.volume, period: 14 });
  const volumeEma = EMA.calculate({ period: 14, values: data.quoteVolume });

  return {
    ema8: ema8.slice(-3), ema21: ema21.slice(-3), ema50: ema50.slice(-3), ema100: ema100.slice(-3),
    rsi: rsi[rsi.length - 1], mfi: mfi[mfi.length - 1], adx: adx[adx.length - 1], atr: atr[atr.length - 1],
    avgVolUsdt: volumeEma[volumeEma.length - 1]
  };
}

function checkAlignment(inds) {
  const { ema8, ema21, ema50, ema100 } = inds;
  const isBull = (i) => ema8[i] > ema21[i] && ema21[i] > ema50[i] && ema50[i] > ema100[i];
  const isBear = (i) => ema8[i] < ema21[i] && ema21[i] < ema50[i] && ema50[i] < ema100[i];

  if ((isBull(2) || isBull(1)) && !isBull(0)) return 'RECENTLY_BULLISH';
  if ((isBear(2) || isBear(1)) && !isBear(0)) return 'RECENTLY_BEARISH';

  const maxEma = Math.max(ema8[2], ema21[2], ema50[2], ema100[2]);
  const minEma = Math.min(ema8[2], ema21[2], ema50[2], ema100[2]);
  if (((maxEma - minEma) / minEma) * 100 < 0.5 && !isBull(2) && !isBear(2)) return 'COMPRESSING';

  return null;
}

async function runScanner() {
  console.log("Bot started. Listening for Telegram commands concurrently...");

  await sendWelcomeMessage();

  while (true) {
    try {
      const dtStart = new Date();
      const startFormatted = formatAlertTime(dtStart);
      console.log(`\n[${startFormatted}] Starting cycle. TFs: ${CONFIG.timeframes.join(', ')}`);

      const symbols = await fetchUsdtPairs();
      const tickerMap = await fetchBinanceTickers();
      const marketCapMap = await fetchMarketCaps(symbols);

      const matches = [];

      for (const symbol of symbols) {
        const ticker = tickerMap.get(symbol);
        if (!ticker || ticker.vol24h < CONFIG.minVol) continue;

        const marketCap = marketCapMap.get(symbol) || 0;
        if (CONFIG.minCap > 0 && marketCap < CONFIG.minCap) continue;

        for (const timeframe of CONFIG.timeframes) {
          try {
            const klineData = await fetchKlines(symbol, timeframe);
            if (klineData.close.length < 100) continue;

            const inds = calculateIndicators(klineData);
            const status = checkAlignment(inds);

            if (status) {
              const tvLink = generateTvLink(symbol, timeframe);
              const now = new Date();
              const alertTimeFormatted = formatAlertTime(now);

              const currentEma8 = inds.ema8[2];
              const prcEma8Pct = ((ticker.price - currentEma8) / currentEma8) * 100;

              const currentTfVol = klineData.quoteVolume[klineData.quoteVolume.length - 1];
              const volEmaPct = (currentTfVol / inds.avgVolUsdt) * 100;

              const atrPctValue = (inds.atr / ticker.price) * 100;

              const msg = `🚨 <b>${status}</b>\n` +
                `📌 <b>Pair:</b> ${symbol}\n` +
                `⏳ <b>TF:</b> ${timeframe} (Alt+G on TV: ${alertTimeFormatted})\n` +
                `💵 <b>Price:</b> $${ticker.price.toFixed(4)}\n` +
                `📈 <b>Prc/EMA8:</b> ${prcEma8Pct > 0 ? '+' : ''}${prcEma8Pct.toFixed(2)}%\n` +
                `📊 <b>TF Vol / EMA:</b> ${volEmaPct.toFixed(0)}%\n` +
                `🔗 <a href="${tvLink}">View on TradingView</a>`;

              sendTelegramMessage(msg);
              console.log(`[ALERT] ${symbol} | ${timeframe} | ${status}`);

              matches.push({
                symbol, timeframe, status, tvLink, alertTime: alertTimeFormatted,
                rawTimestamp: now.getTime(), rawTimeframe: getTfWeight(timeframe),
                rawVol24h: ticker.vol24h, rawEmaVol: inds.avgVolUsdt, rawMarketCap: marketCap,
                rawAtrPct: atrPctValue, rawPrcEma8Pct: prcEma8Pct,
                rawTfVol: currentTfVol, rawVolEmaPct: volEmaPct,
                price: ticker.price.toFixed(4), vol24h: formatNum(ticker.vol24h),
                emaVol: formatNum(inds.avgVolUsdt), marketCap: formatNum(marketCap),
                prcEma8Pct: prcEma8Pct.toFixed(2), tfVol: formatNum(currentTfVol),
                volEmaPct: volEmaPct.toFixed(2),
                ema8: currentEma8.toFixed(4), ema21: inds.ema21[2].toFixed(4),
                ema50: inds.ema50[2].toFixed(4),
                rsi: inds.rsi.toFixed(2), mfi: inds.mfi.toFixed(2),
                adx: inds.adx.adx.toFixed(2), atr: inds.atr.toFixed(4),
                atrPct: atrPctValue.toFixed(2)
              });
            }
            await sleep(40);
          } catch (err) { }
        }
      }

      // Cycle Execution Calculations
      const dtEnd = new Date();
      const endFormatted = formatAlertTime(dtEnd);
      const durationMs = dtEnd.getTime() - dtStart.getTime();
      const durationFormatted = formatDuration(durationMs);

      // Calculate unique pairs from the matches array
      const uniqueSymbols = new Set(matches.map(m => m.symbol)).size;

      // Update Global Stats
      lastCycleStats = {
        uniqueAlertedPairs: uniqueSymbols,
        startTime: startFormatted,
        endTime: endFormatted,
        duration: durationFormatted
      };

      console.log(`\n--- Cycle Finished ---`);
      console.log(`Start: ${startFormatted} | End: ${endFormatted} | Duration: ${durationFormatted}`);
      console.log(`Alerted Unique Pairs: ${uniqueSymbols}\n`);

      if (matches.length > 0) {
        await sendTelegramReport(matches, lastCycleStats);
      }

      console.log(`Sleeping for ${LOOP_DELAY_MS / 60000} minutes before next cycle...`);
      await sleep(LOOP_DELAY_MS);

    } catch (error) {
      console.error(`Execution error: ${error.message}`);
      await sleep(60000);
    }
  }
}

pollTelegram();
runScanner();