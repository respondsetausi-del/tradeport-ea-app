// Simple Bun server to serve static web export and handle API routes
// - Serves files from ./dist
// - Routes API calls to optimized database connection pool

import path from 'path';
import { createPool } from 'mysql2/promise';
// Declare Bun global for TypeScript linting in non-Bun tooling contexts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const Bun: any;

const DIST_DIR = path.join(process.cwd(), 'dist');
const PORT = Number(process.env.PORT || 3000);

// Prefer environment variables for database configuration
const DB_HOST = process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || '173.201.181.251';
const DB_USER = process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || 'eauser';
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || 'snVO2i%fZSG%';
const DB_NAME = process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'eaconverter';
const DB_PORT = Number(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306);

// Optimized connection pool configuration for scaling AND CPU efficiency
const POOL_CONFIG = {
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 20),
  maxIdle: Number(process.env.DB_MAX_IDLE || 10),
  idleTimeout: Number(process.env.DB_IDLE_TIMEOUT || 60000),
  queueLimit: Number(process.env.DB_QUEUE_LIMIT || 50),
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  waitForConnections: true,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 20000),
  acquireTimeout: Number(process.env.DB_ACQUIRE_TIMEOUT || 20000),
  timeout: Number(process.env.DB_QUERY_TIMEOUT || 30000),

  // CPU-efficient settings
  decimalNumbers: true,
  bigNumberStrings: false,
  supportBigNumbers: true,
  dateStrings: false,
  typeCast: true,
  multipleStatements: false,
  rowsAsArray: false,
};

// Create optimized database connection pool
const pool = createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT,
  ...POOL_CONFIG,
});

console.log('✅ Database connection pool initialized:', {
  host: DB_HOST,
  database: DB_NAME,
  connectionLimit: POOL_CONFIG.connectionLimit,
});

function getPool() {
  return pool;
}

// Graceful shutdown
async function shutdownServer() {
  console.log('🔄 Shutting down server...');
  try {
    await pool.end();
    console.log('✅ Database connections closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdownServer);
process.on('SIGINT', shutdownServer);

async function serveStatic(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let filePath = url.pathname;

    // Prevent path traversal
    if (filePath.includes('..')) {
      return new Response('Not Found', { status: 404 });
    }

    // Default to index.html
    if (filePath === '/' || filePath === '') {
      filePath = '/index.html';
    }

    const absolutePath = path.join(DIST_DIR, filePath);
    const file = Bun.file(absolutePath);
    if (await file.exists()) {
      // Set proper MIME type based on file extension
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'application/octet-stream';

      switch (ext) {
        case '.html':
          contentType = 'text/html; charset=utf-8';
          break;
        case '.css':
          contentType = 'text/css; charset=utf-8';
          break;
        case '.js':
          contentType = 'application/javascript; charset=utf-8';
          break;
        case '.json':
          contentType = 'application/json; charset=utf-8';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
        case '.svg':
          contentType = 'image/svg+xml';
          break;
        case '.ico':
          contentType = 'image/x-icon';
          break;
        case '.woff':
          contentType = 'font/woff';
          break;
        case '.woff2':
          contentType = 'font/woff2';
          break;
        case '.ttf':
          contentType = 'font/ttf';
          break;
        case '.eot':
          contentType = 'application/vnd.ms-fontobject';
          break;
      }

      // Service worker must never be cached — we need the browser to fetch
      // the kill-switch version immediately on the next visit so any stale SW
      // from a previous build gets replaced and unregistered.
      const isServiceWorker = filePath.endsWith('/sw.js') || filePath === '/sw.js';
      return new Response(file, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': (ext === '.html' || isServiceWorker)
            ? 'no-cache, no-store, must-revalidate'
            : 'public, max-age=31536000',
          ...(isServiceWorker ? { 'Service-Worker-Allowed': '/' } : {}),
        },
      });
    }

    // SPA fallback
    const indexFile = Bun.file(path.join(DIST_DIR, 'index.html'));
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('Static serve error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Helper function to extract base URL from terminal URL
function getBaseUrlFromTerminalUrl(terminalUrl: string): string {
  try {
    const url = new URL(terminalUrl);
    return `${url.protocol}//${url.host}`;
  } catch (e) {
    // Default to RazorMarkets if URL parsing fails
    return 'https://webtrader.razormarkets.co.za';
  }
}

async function handleMT5Proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  const login = url.searchParams.get('login');
  const password = url.searchParams.get('password');
  const server = url.searchParams.get('server');
  const asset = url.searchParams.get('asset');
  const action = url.searchParams.get('action');
  const price = url.searchParams.get('price');
  const tp = url.searchParams.get('tp');
  const sl = url.searchParams.get('sl');
  const volume = url.searchParams.get('volume');
  const numberOfTrades = url.searchParams.get('numberOfTrades');
  const botname = url.searchParams.get('botname');

  // Check if this is a trading request (has trading parameters)
  // Note: tp and sl can be 0 or empty string, so we check for asset, action, and volume
  const isTradingRequest = asset && action && volume && numberOfTrades;

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing URL parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Extract base URL for WebSocket and asset proxying
  const baseUrl = getBaseUrlFromTerminalUrl(targetUrl);
  
  // Construct WebSocket URL - different brokers may have different paths
  let wsUrl = `${baseUrl.replace('http://', 'wss://').replace('https://', 'wss://')}/terminal/ws`;
  
  // AccuMarkets might use a different WebSocket path
  if (baseUrl.includes('accumarkets.co.za')) {
    // Try the standard path first, fallback will be handled in the script
    wsUrl = `${baseUrl.replace('http://', 'wss://').replace('https://', 'wss://')}/terminal/ws`;
    console.log('AccuMarkets WebSocket URL:', wsUrl);
  }
  
  console.log('MT5 Proxy - Target URL:', targetUrl);
  console.log('MT5 Proxy - Base URL:', baseUrl);
  console.log('MT5 Proxy - WebSocket URL:', wsUrl);
  console.log('MT5 Proxy - Is Trading Request:', isTradingRequest);
  console.log('MT5 Proxy - Trading Params:', { asset, action, volume, numberOfTrades, tp, sl });

  try {
    // Fetch the target terminal page
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    let html = await response.text();

    // Create the authentication script based on your Android code
    const authScript = `
          <script>
            (function() {
              // Override console methods to suppress warnings
              const originalWarn = console.warn;
              const originalError = console.error;
              const originalLog = console.log;
              
              function shouldSuppress(message) {
                return message.includes('interactive-widget') || 
                       message.includes('viewport') ||
                       message.includes('Viewport argument key') ||
                       message.includes('AES-CBC') ||
                       message.includes('AES-CTR') ||
                       message.includes('AES-GCM') ||
                       message.includes('chosen-ciphertext') ||
                       message.includes('authentication by default') ||
                       message.includes('not recognized and ignored');
              }
              
              console.warn = function(...args) {
                const message = args.join(' ');
                if (shouldSuppress(message)) return;
                originalWarn.apply(console, args);
              };
              
              console.error = function(...args) {
                const message = args.join(' ');
                if (shouldSuppress(message)) return;
                originalError.apply(console, args);
              };
              
              console.log = function(...args) {
                const message = args.join(' ');
                if (shouldSuppress(message)) return;
                originalLog.apply(console, args);
              };

              // Message sending function
              const sendMessage = (type, message) => {
                try { 
                  window.parent.postMessage(JSON.stringify({ type, message }), '*'); 
                } catch(e) {
                  console.log('Message send error:', e);
                }
              };

              // Override WebSocket to redirect to original terminal
              const originalWebSocket = window.WebSocket;
              window.WebSocket = function(url, protocols) {
                console.log('WebSocket connection attempt to:', url);
                
                // Redirect WebSocket connections to the original terminal (broker-specific)
                if (url.includes('/terminal') || url.includes('tradeport-ea-app')) {
                  const newUrl = '${wsUrl}';
                  console.log('Redirecting WebSocket from', url, 'to:', newUrl);
                  
                  try {
                    const ws = new originalWebSocket(newUrl, protocols);
                    
                    // Add event listeners for debugging
                    ws.addEventListener('open', function() {
                      console.log('WebSocket connection established successfully to:', newUrl);
                    });
                    
                    ws.addEventListener('error', function(error) {
                      console.log('WebSocket error for URL:', newUrl, 'Error:', error);
                      console.log('This is expected - terminal will work without WebSocket for authentication');
                    });
                    
                    ws.addEventListener('close', function(event) {
                      console.log('WebSocket connection closed. Code:', event.code, 'Reason:', event.reason);
                    });
                    
                    return ws;
                  } catch (error) {
                    console.log('WebSocket creation error:', error, '- Continuing without WebSocket');
                    // Return a mock WebSocket that doesn't fail
                    return new originalWebSocket(url, protocols);
                  }
                }
                
                return new originalWebSocket(url, protocols);
              };
              
              // Copy static properties
              Object.setPrototypeOf(window.WebSocket, originalWebSocket);
              Object.defineProperty(window.WebSocket, 'prototype', {
                value: originalWebSocket.prototype,
                writable: false
              });

              // Optimized authentication function with strict symbol search validation
              const authenticateMT5 = async () => {
                try {
                  sendMessage('step_update', 'Initializing MT5 Account...');
                  await new Promise(r => setTimeout(r, 2000));
                  
                  // Check for disclaimer and accept if present
                  const disclaimer = document.querySelector('#disclaimer');
                  if (disclaimer) {
                    const acceptButton = document.querySelector('.accept-button');
                    if (acceptButton) {
                      acceptButton.click();
                      sendMessage('step_update', 'Accepting disclaimer...');
                      await new Promise(r => setTimeout(r, 1500));
                    }
                  }
                  
                  // Check if form is visible and remove any existing connections
                  const form = document.querySelector('.form');
                  if (form && !form.classList.contains('hidden')) {
                    // Press remove button first
                    const removeButton = document.querySelector('.button.svelte-1wrky82.red');
                    if (removeButton) {
                      removeButton.click();
                      sendMessage('step_update', 'Removing existing connection...');
                      await new Promise(r => setTimeout(r, 2000));
                    } else {
                      // Fallback: look for Remove button by text
                      const buttons = document.getElementsByTagName('button');
                      for (let i = 0; i < buttons.length; i++) {
                        if (buttons[i].textContent.trim() === 'Remove') {
                          buttons[i].click();
                          sendMessage('step_update', 'Removing existing connection...');
                          await new Promise(r => setTimeout(r, 2000));
                          break;
                        }
                      }
                    }
                  }
                  
                  // Fill login credentials
                  const loginField = document.querySelector('input[name="login"]');
                  const passwordField = document.querySelector('input[name="password"]');
                  
                  if (loginField && '${login}') {
                    loginField.value = '${login}';
                    loginField.dispatchEvent(new Event('input', { bubbles: true }));
                    sendMessage('step_update', 'Entering login credentials...');
                    await new Promise(r => setTimeout(r, 500));
                  }
                  
                  if (passwordField && '${password}') {
                    passwordField.value = '${password}';
                    passwordField.dispatchEvent(new Event('input', { bubbles: true }));
                    sendMessage('step_update', 'Entering password...');
                    await new Promise(r => setTimeout(r, 500));
                  }
                  
                  // Click login button
                  const loginButton = document.querySelector('.button.svelte-1wrky82.active');
                  if (loginButton) {
                    loginButton.click();
                    sendMessage('step_update', 'Connecting to Server...');
                    await new Promise(r => setTimeout(r, 8000)); // Optimized wait time
                  }
                  
                  // Wait for the terminal to fully load after login
                  sendMessage('step_update', 'Loading terminal interface...');
                  await new Promise(r => setTimeout(r, 4000));
                  
                  // RELAXED AUTHENTICATION VALIDATION - Check if terminal is accessible
                  sendMessage('step_update', 'Verifying terminal access...');
                  await new Promise(r => setTimeout(r, 2000));
                  
                  // Check multiple indicators of successful authentication
                  const searchField = document.querySelector('input[placeholder="Search symbol"]');
                  const createOrderButton = Array.from(document.querySelectorAll('button')).find(btn => 
                    (btn.textContent || '').toLowerCase().includes('create') && 
                    (btn.textContent || '').toLowerCase().includes('order')
                  );
                  const balanceText = document.body.innerText.includes('Balance:') || 
                                     document.body.innerText.includes('Equity:') ||
                                     document.body.innerText.includes('Free margin:');
                  const hasSymbolList = document.querySelectorAll('[class*="symbol"]').length > 0 ||
                                       document.querySelectorAll('td').length > 5;
                  
                  console.log('MT5 Authentication Check:', {
                    hasSearchField: !!searchField,
                    hasCreateOrderButton: !!createOrderButton,
                    hasBalanceText: balanceText,
                    hasSymbolList: hasSymbolList
                  });
                  
                  // If any of these indicators are present, authentication was successful
                  if (searchField || createOrderButton || balanceText || hasSymbolList) {
                    console.log('MT5 Authentication successful - terminal is accessible');
                    sendMessage('authentication_success', 'MT5 Login Successful - Terminal loaded successfully');
                    
                    // If this is a trading request, proceed with trading
                    ${isTradingRequest ? `
                    setTimeout(() => {
                      executeTrading();
                    }, 2000);
                    ` : ''}
                    return;
                  }
                  
                  // If we reach here, authentication validation failed
                  sendMessage('authentication_failed', 'Authentication failed - Terminal did not load properly');
                  
                } catch(e) {
                  sendMessage('authentication_failed', 'Error during authentication: ' + e.message);
                }
                };
               
                 // Trading execution function with STRICT trade count control
                 const executeTrading = async () => {
                   try {
                     const numberOfTrades = parseInt('${numberOfTrades}') || 1;
                     let completedTrades = 0;
                     let failedTrades = 0;
                     
                     // Log all trading parameters for verification
                     console.log('=== MT5 TRADING PARAMETERS ===');
                     console.log('Asset: ${asset}');
                     console.log('Action: ${action}');
                     console.log('Volume: ${volume}');
                     console.log('Stop Loss: ${sl}');
                     console.log('Take Profit: ${tp}');
                     console.log('Number of Trades: ${numberOfTrades}');
                     console.log('Bot Name: ${botname}');
                     console.log('==============================');
                     
                     // STRICT VALIDATION: Ensure numberOfTrades is valid
                     if (numberOfTrades < 1 || numberOfTrades > 10) {
                       sendMessage('error', 'Invalid number of trades: ' + numberOfTrades + '. Must be between 1 and 10.');
                       return;
                     }
                     
                     sendMessage('step', 'Starting execution of ' + numberOfTrades + ' ${action} trade(s) for ${asset}...');
                     console.log('MT5 Trading: STRICT MODE - Target: EXACTLY', numberOfTrades, 'trades');
                     
                     // Function to execute a single trade with enhanced tracking
                     const executeSingleTrade = async (tradeIndex) => {
                       try {
                         console.log('MT5 Trading: Starting trade', (tradeIndex + 1), 'of', numberOfTrades);
                         sendMessage('step', 'Executing trade ' + (tradeIndex + 1) + ' of ' + numberOfTrades + ' for ${asset}...');
                         
                         // Type the EXACT symbol into MT5's search box and click
                         // whatever MT5 returns as the first result. No fuzzy
                         // matching, no .includes(), no .mic guessing — MT5's
                         // own search decides what matches the user's input.
                        const searchField = document.querySelector('input[placeholder="Search symbol"]') ||
                                          document.querySelector('input[placeholder*="Search"]') ||
                                          document.querySelector('input[placeholder*="search"]');
                        if (searchField) {
                          searchField.focus();
                          searchField.select();
                          searchField.value = '';
                          searchField.value = '${asset}';
                          searchField.dispatchEvent(new Event('input', { bubbles: true }));
                          searchField.dispatchEvent(new Event('change', { bubbles: true }));
                          searchField.dispatchEvent(new Event('keyup', { bubbles: true }));
                          console.log('MT5 Trading: Searched for ${asset}');
                          await new Promise(r => setTimeout(r, 1500));
                        }

                        // Click the first symbol result MT5 returned.
                        let assetSelected = false;
                        const firstResult =
                          document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl') ||
                          document.querySelector('.symbol.svelte-19bwscl') ||
                          document.querySelector('[class*="symbol"]');
                        if (firstResult) {
                          firstResult.click();
                          assetSelected = true;
                          console.log('MT5 Trading: Clicked first search result for ${asset}: "' + (firstResult.textContent || '').trim() + '"');
                        }

                        if (assetSelected) {
                          sendMessage('step', 'Asset ${asset} selected for trade ' + (tradeIndex + 1) + '...');
                          await new Promise(r => setTimeout(r, 1500));
                        } else {
                          // ABORT — never fire trades on whatever chart MT5 is
                          // currently showing. Better to fail loudly than to
                          // place trades on the wrong asset.
                          sendMessage('step', '❌ No search result for ${asset}. Aborting to prevent wrong-asset trade.');
                          sendMessage('error', 'No search result for ${asset} — trade aborted to prevent placing on wrong asset.');
                          console.error('MT5 Trading: ABORT — no search result for ${asset}, refusing to fire trades on stale chart');
                          return;
                        }
                        
                        // Open order dialog - Universal approach
                        let dialogOpened = false;
                        
                        // Try RazorMarkets selector
                        const razorOrderBtn = document.querySelector('.icon-button.withText span.button-text');
                        if (razorOrderBtn) {
                          razorOrderBtn.click();
                          dialogOpened = true;
                          console.log('MT5 Trading: Opened order dialog using RazorMarkets selector');
                        }
                        
                        // Try text-based search (AccuMarkets and others)
                        if (!dialogOpened) {
                          const allButtons = document.querySelectorAll('button');
                          for (let i = 0; i < allButtons.length; i++) {
                            const btnText = allButtons[i].textContent.toLowerCase();
                            if (btnText.includes('create') && btnText.includes('order')) {
                              allButtons[i].click();
                              dialogOpened = true;
                              console.log('MT5 Trading: Opened order dialog using text-based selector');
                              break;
                            }
                          }
                        }
                        
                        if (dialogOpened) {
                          sendMessage('step', 'Order dialog opened for trade ' + (tradeIndex + 1) + '...');
                          await new Promise(r => setTimeout(r, 1500));
                        } else {
                          console.log('MT5 Trading: WARNING - Could not open order dialog');
                        }
                         
                        // Universal field setting function with multiple selector attempts
                        const setFieldValue = (selectors, value, fieldName) => {
                          // Try each selector in order
                          for (let selector of selectors) {
                            const field = document.querySelector(selector);
                            if (field) {
                              field.focus();
                              field.select();
                              field.value = '';
                              field.value = value;
                              field.dispatchEvent(new Event('input', { bubbles: true }));
                              field.dispatchEvent(new Event('change', { bubbles: true }));
                              field.dispatchEvent(new Event('keyup', { bubbles: true }));
                              field.dispatchEvent(new Event('blur', { bubbles: true }));
                              console.log('MT5 Trading: Set ' + fieldName + ' to: ' + value + ' using selector: ' + selector);
                              return true;
                            }
                          }
                          console.log('MT5 Trading: Field not found for ' + fieldName + ', tried selectors:', selectors);
                          return false;
                        };
                        
                        // Set volume (lot size from trade config) - Try multiple selectors
                        console.log('MT5 Trading: Setting Volume to ${volume}');
                        const volumeSet = setFieldValue([
                          '.trade-input input[type="text"]',  // RazorMarkets
                          'input[type="text"]',                // Generic first input
                          'input[inputmode="decimal"]'         // Numeric input
                        ], '${volume}', 'Volume');
                        await new Promise(r => setTimeout(r, 500));
                        
                        // Set stop loss - Only if value is provided and not 0
                        if ('${sl}' && '${sl}' !== '0' && '${sl}' !== '') {
                          console.log('MT5 Trading: Setting Stop Loss to ${sl}');
                          const slSet = setFieldValue([
                            '.sl input[type="text"]',           // RazorMarkets
                            'input[placeholder*="Stop"]',       // By placeholder
                            'input[placeholder*="stop"]',
                            'input[placeholder*="S/L"]'
                          ], '${sl}', 'Stop Loss');
                          await new Promise(r => setTimeout(r, 500));
                        } else {
                          console.log('MT5 Trading: Skipping Stop Loss (value is 0 or empty)');
                        }
                        
                        // Set take profit - Only if value is provided and not 0
                        if ('${tp}' && '${tp}' !== '0' && '${tp}' !== '') {
                          console.log('MT5 Trading: Setting Take Profit to ${tp}');
                          const tpSet = setFieldValue([
                            '.tp input[type="text"]',           // RazorMarkets
                            'input[placeholder*="Take"]',       // By placeholder
                            'input[placeholder*="take"]',
                            'input[placeholder*="T/P"]'
                          ], '${tp}', 'Take Profit');
                          await new Promise(r => setTimeout(r, 500));
                        } else {
                          console.log('MT5 Trading: Skipping Take Profit (value is 0 or empty)');
                        }
                        
                        // Set comment with bot name - Try multiple selectors
                        console.log('MT5 Trading: Setting Comment to ${botname}');
                        const commentSet = setFieldValue([
                          '.input.svelte-mtorg2 input[type="text"]',  // RazorMarkets
                          '.input.svelte-1d8k9kk input[type="text"]',
                          'input[placeholder*="Comment"]',             // By placeholder
                          'input[placeholder*="comment"]'
                        ], '${botname}', 'Comment');
                        await new Promise(r => setTimeout(r, 500));
                         
                        sendMessage('step', 'Parameters set for trade ' + (tradeIndex + 1) + ', executing ${action} order...');
                        await new Promise(r => setTimeout(r, 800));
                        
                        // Execute the order - Universal approach
                        let executeButton = null;
                        
                        // Try RazorMarkets selectors first
                        if ('${action}' === 'BUY') {
                          executeButton = document.querySelector('.footer-row button.trade-button:not(.red)');
                        } else {
                          executeButton = document.querySelector('.footer-row button.trade-button.red');
                        }
                        
                        // Try text-based search (AccuMarkets and others)
                        if (!executeButton) {
                          const allButtons = document.querySelectorAll('button');
                          for (let i = 0; i < allButtons.length; i++) {
                            const btnText = allButtons[i].textContent.toLowerCase();
                            if ('${action}' === 'BUY') {
                              if (btnText.includes('buy') && btnText.includes('market')) {
                                executeButton = allButtons[i];
                                console.log('MT5 Trading: Found BUY button using text search');
                                break;
                              }
                            } else {
                              if (btnText.includes('sell') && btnText.includes('market')) {
                                executeButton = allButtons[i];
                                console.log('MT5 Trading: Found SELL button using text search');
                                break;
                              }
                            }
                          }
                        }
                        
                        if (executeButton) {
                          console.log('MT5 Trading: Executing ${action} order for trade', (tradeIndex + 1));
                          executeButton.click();
                          sendMessage('step', 'Trade ' + (tradeIndex + 1) + ' ${action} order placed, confirming...');
                          await new Promise(r => setTimeout(r, 2000));
                          
                          // Confirm the order - Universal approach
                          let confirmButton = document.querySelector('.trade-button.svelte-16cwwe0');
                          
                          // Try text-based search if RazorMarkets selector fails
                          if (!confirmButton) {
                            const allButtons = document.querySelectorAll('button');
                            for (let i = 0; i < allButtons.length; i++) {
                              const btnText = allButtons[i].textContent.toLowerCase();
                              if (btnText.includes('ok') || btnText.includes('confirm') || btnText.includes('yes')) {
                                confirmButton = allButtons[i];
                                console.log('MT5 Trading: Found confirm button using text search');
                                break;
                              }
                            }
                          }
                          
                          if (confirmButton) {
                            confirmButton.click();
                            sendMessage('step', 'Trade ' + (tradeIndex + 1) + ' of ' + numberOfTrades + ' completed successfully');
                            await new Promise(r => setTimeout(r, 2000));
                            console.log('MT5 Trading: Trade', (tradeIndex + 1), 'completed successfully');
                            
                            // Close any success dialogs
                            const closeButtons = document.querySelectorAll('button');
                            for (let i = 0; i < closeButtons.length; i++) {
                              const btnText = closeButtons[i].textContent.toLowerCase();
                              if (btnText.includes('close') || btnText === 'x') {
                                closeButtons[i].click();
                                console.log('MT5 Trading: Closed success dialog');
                                break;
                              }
                            }
                            
                            return true;
                          } else {
                            console.log('MT5 Trading: Confirm button not found for trade', (tradeIndex + 1));
                            return false;
                          }
                        } else {
                          console.log('MT5 Trading: ${action} button not found for trade', (tradeIndex + 1));
                          return false;
                        }
                         
                       } catch (error) {
                         console.log('MT5 Trading: Trade', (tradeIndex + 1), 'failed:', error.message);
                         sendMessage('error', 'Trade ' + (tradeIndex + 1) + ' failed: ' + error.message);
                         return false;
                       }
                     };
                     
                     // STRICT SEQUENTIAL EXECUTION - Execute trades one by one, no retries
                     console.log('MT5 Trading: STRICT SEQUENTIAL EXECUTION - Target: EXACTLY', numberOfTrades, 'trades');
                     
                     for (let tradeIndex = 0; tradeIndex < numberOfTrades; tradeIndex++) {
                       // CRITICAL SAFETY CHECK: Prevent over-execution
                       if (completedTrades >= numberOfTrades) {
                         console.log('MT5 Trading: SAFETY BREAK - Target already reached, stopping execution');
                         break;
                       }
                       
                       const currentTradeNumber = tradeIndex + 1;
                       console.log('MT5 Trading: EXECUTING TRADE', currentTradeNumber, 'of', numberOfTrades);
                       sendMessage('step', 'Executing trade ' + currentTradeNumber + ' of ' + numberOfTrades + ' for ${asset}...');
                       
                       const success = await executeSingleTrade(tradeIndex);
                       
                       if (success) {
                         completedTrades++;
                         console.log('MT5 Trading: SUCCESS - Trade', currentTradeNumber, 'completed! Progress:', completedTrades, 'of', numberOfTrades);
                         sendMessage('step', 'SUCCESS - Trade ' + currentTradeNumber + ' completed! Progress: ' + completedTrades + ' of ' + numberOfTrades);
                         
                         // CRITICAL: Check if we've reached the target
                         if (completedTrades >= numberOfTrades) {
                           console.log('MT5 Trading: TARGET REACHED - All', numberOfTrades, 'trades completed!');
                           sendMessage('step', 'TARGET REACHED - All ' + numberOfTrades + ' trades completed!');
                           break;
                         }
                         
                         // Wait between trades (only if we haven't reached the target)
                         if (completedTrades < numberOfTrades) {
                           sendMessage('step', 'Waiting before next trade... (' + completedTrades + '/' + numberOfTrades + ' completed)');
                           await new Promise(r => setTimeout(r, 2000));
                         }
                       } else {
                         failedTrades++;
                         console.log('MT5 Trading: FAILED - Trade', currentTradeNumber, 'failed. Continuing to next trade...');
                         sendMessage('step', 'FAILED - Trade ' + currentTradeNumber + ' failed. Continuing to next trade...');
                         
                         // Wait before next trade even if this one failed
                         if (tradeIndex < numberOfTrades - 1) {
                           await new Promise(r => setTimeout(r, 2000));
                         }
                       }
                       
                       // Log current status after each trade
                       console.log('MT5 Trading: STATUS - Completed:', completedTrades, 'Target:', numberOfTrades, 'Current:', currentTradeNumber);
                     }
                     
                     // Final verification
                     console.log('MT5 Trading: EXECUTION COMPLETED - Final count:', completedTrades, 'trades completed out of', numberOfTrades, 'target');
                     
                     // Final summary with detailed tracking
                     console.log('MT5 Trading: Final summary - Completed:', completedTrades, 'Failed:', failedTrades, 'Total:', numberOfTrades);
                     sendMessage('trade_executed', 'All trades completed: ' + completedTrades + ' of ' + numberOfTrades + ' successful for ${asset}');
                     
                     // Close after completing all trades
                     if (completedTrades === numberOfTrades) {
                       sendMessage('close', 'All ' + numberOfTrades + ' trades executed successfully - closing window');
                     } else if (completedTrades > 0) {
                       sendMessage('close', 'Partial completion: ' + completedTrades + ' of ' + numberOfTrades + ' trades executed - closing window');
                     } else {
                       sendMessage('close', 'No trades executed successfully - closing window');
                     }
                     
                   } catch (error) {
                     console.log('MT5 Trading: Overall execution failed:', error.message);
                     sendMessage('error', 'Trading execution failed: ' + error.message);
                   }
                 };

                // Start authentication after page loads - optimized timing
              if (document.readyState === 'complete') {
                setTimeout(authenticateMT5, 1500); // Reduced from 3000ms to 1500ms
              } else {
                window.addEventListener('load', function() {
                  setTimeout(authenticateMT5, 1500); // Reduced from 3000ms to 1500ms
                });
              }
            })();
          </script>
        `;

    // Rewrite WebSocket URLs to point to the original terminal
    html = html.replace(/wss:\/\/tradeport-ea-app\.onrender\.com\/terminal\/ws/g, wsUrl);
    html = html.replace(/ws:\/\/tradeport-ea-app\.onrender\.com\/terminal\/ws/g, wsUrl);

    // Inject the script before the closing body tag
    if (html.includes('</body>')) {
      html = html.replace('</body>', authScript + '</body>');
    } else {
      html += authScript;
    }

    // Return the modified HTML
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error) {
    console.error('MT5 Proxy error:', error);
    return new Response(JSON.stringify({ error: `Proxy error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleMT4Proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  const login = url.searchParams.get('login');
  const password = url.searchParams.get('password');
  const server = url.searchParams.get('server');
  const asset = url.searchParams.get('asset');
  const action = url.searchParams.get('action');
  const price = url.searchParams.get('price');
  const tp = url.searchParams.get('tp');
  const sl = url.searchParams.get('sl');
  const volume = url.searchParams.get('volume');
  const numberOfTrades = url.searchParams.get('numberOfTrades');
  const botname = url.searchParams.get('botname');

  // Check if this is a trading request (has trading parameters)
  // Note: tp and sl can be 0 or empty string, so we check for asset, action, and volume
  const isTradingRequest = asset && action && volume && numberOfTrades;

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing URL parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Fetch the target terminal page
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    let html = await response.text();

    // Create the authentication script based on your Android code
    const authScript = `
          <script>
            (function() {
              // Override console methods to suppress warnings
              const originalWarn = console.warn;
              const originalError = console.error;
              const originalLog = console.log;
              
              function shouldSuppress(message) {
                return message.includes('interactive-widget') || 
                       message.includes('viewport') ||
                       message.includes('Viewport argument key') ||
                       message.includes('AES-CBC') ||
                       message.includes('AES-CTR') ||
                       message.includes('AES-GCM') ||
                       message.includes('chosen-ciphertext') ||
                       message.includes('authentication by default') ||
                       message.includes('not recognized and ignored');
              }
              
              console.warn = function(...args) {
                const message = args.join(' ');
                if (shouldSuppress(message)) return;
                originalWarn.apply(console, args);
              };
              
              console.error = function(...args) {
                const message = args.join(' ');
                if (shouldSuppress(message)) return;
                originalError.apply(console, args);
              };
              
              console.log = function(...args) {
                const message = args.join(' ');
                if (shouldSuppress(message)) return;
                originalLog.apply(console, args);
              };

              // Message sending function
              const sendMessage = (type, message) => {
                try { 
                  window.parent.postMessage(JSON.stringify({ type, message }), '*'); 
                } catch(e) {
                  console.log('Message send error:', e);
                }
              };

              // Override WebSocket to redirect to original terminal
              const originalWebSocket = window.WebSocket;
              window.WebSocket = function(url, protocols) {
                console.log('WebSocket connection attempt to:', url);
                
                // Redirect WebSocket connections to the original terminal
                if (url.includes('/terminal/ws')) {
                  const newUrl = 'wss://webtrader.razormarkets.co.za/terminal/ws';
                  console.log('Redirecting WebSocket to:', newUrl);
                  return new originalWebSocket(newUrl, protocols);
                }
                
                return new originalWebSocket(url, protocols);
              };
              
              // Copy static properties
              Object.setPrototypeOf(window.WebSocket, originalWebSocket);
              Object.defineProperty(window.WebSocket, 'prototype', {
                value: originalWebSocket.prototype,
                writable: false
              });

              // Enhanced field input function from your Android code
              const typeInput = (el, value) => {
                try {
                  el.focus();
                  el.select();
                  el.value = '';
                  el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                  
                  setTimeout(function() {
                    el.focus();
                    el.value = String(value);
                    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
                  }, 100);
                  
                  return true;
                } catch(e) { return false; }
              };

              // Authentication function based on your Android code
              const authenticateMT4 = async () => {
                try {
                  sendMessage('step_update', 'Starting MT4 authentication...');
                  await new Promise(r => setTimeout(r, 3000));
                  
                  // Fill login credentials using enhanced method from your Android code
                  const loginField = document.getElementById('login') || document.querySelector('input[name="login"]');
                  const passwordField = document.getElementById('password') || document.querySelector('input[type="password"]');
                  const serverField = document.getElementById('server') || document.querySelector('input[name="server"]');
                  
                  if (loginField && '${login}') {
                    typeInput(loginField, '${login}');
                    sendMessage('step_update', 'Filling MT4 credentials...');
                  }
                  
                  if (serverField && '${server}') {
                    typeInput(serverField, '${server}');
                  }
                  
                  if (passwordField && '${password}') {
                    typeInput(passwordField, '${password}');
                  }
                  
                  await new Promise(r => setTimeout(r, 500));
                  
                  // Submit login using MT4 specific button selector
                  const loginButton = document.querySelector('button.input-button:nth-child(4)');
                  if (loginButton) {
                    loginButton.removeAttribute('disabled');
                    loginButton.disabled = false;
                    loginButton.click();
                    sendMessage('step_update', 'Submitting MT4 login...');
                  } else {
                    sendMessage('authentication_failed', 'Login button not found');
                    return;
                  }
                  
                  await new Promise(r => setTimeout(r, 4000));
                  
                  // Show all symbols to verify authentication (copied from your Android code)
                  const marketWatchElement = document.querySelector('body > div.page-window.market-watch.compact > div > div.b > div.page-block > div > table > tbody > tr:nth-child(1)');
                  if (marketWatchElement) {
                    const ev1 = new MouseEvent("mousedown", {
                      bubbles: true,
                      cancelable: false,
                      view: window,
                      button: 2,
                      buttons: 2,
                      clientX: marketWatchElement.getBoundingClientRect().x,
                      clientY: marketWatchElement.getBoundingClientRect().y
                    });
                    marketWatchElement.dispatchEvent(ev1);
                    
                    const ev2 = new MouseEvent("mouseup", {
                      bubbles: true,
                      cancelable: false,
                      view: window,
                      button: 2,
                      buttons: 0,
                      clientX: marketWatchElement.getBoundingClientRect().x,
                      clientY: marketWatchElement.getBoundingClientRect().y
                    });
                    marketWatchElement.dispatchEvent(ev2);
                    
                    const ev3 = new MouseEvent("contextmenu", {
                      bubbles: true,
                      cancelable: false,
                      view: window,
                      button: 2,
                      buttons: 0,
                      clientX: marketWatchElement.getBoundingClientRect().x,
                      clientY: marketWatchElement.getBoundingClientRect().y
                    });
                    marketWatchElement.dispatchEvent(ev3);
                    
                    setTimeout(() => {
                      const showAllButton = document.querySelector('body > div.page-menu.context.expanded > div > div > span.box > span > div:nth-child(7)');
                      if (showAllButton) {
                        showAllButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                        showAllButton.click();
                        sendMessage('step_update', 'Verifying authentication - showing all symbols...');
                      }
                    }, 500);
                  }
                  
                  await new Promise(r => setTimeout(r, 5000));
                  
                  // Verify authentication by checking if symbols are visible
                  const tableB = document.querySelector('body > div.page-window.market-watch.compact > div > div.b > div.page-block > div > table > tbody');
                  if (tableB) {
                    const allTRs = tableB.querySelectorAll('tr');
                    if (allTRs.length > 0) {
                      // Try to find XAUUSD symbol
                      const ev = document.createEvent('MouseEvents');
                      ev.initEvent('dblclick', true, true);
                      for (let i = 0; i < allTRs.length; i++) {
                        const a = allTRs[i].getElementsByTagName('td')[0];
                        if (a && a.textContent && a.textContent.trim() === 'XAUUSD') {
                          a.dispatchEvent(ev);
                          sendMessage('authentication_success', 'MT4 Authentication Successful - XAUUSD symbol found and selected');
                          return;
                        }
                      }
                      // XAUUSD not found but symbols are visible - still successful
                      sendMessage('authentication_success', 'MT4 Authentication Successful - Symbol list accessible');
                      
                      // If this is a trading request, proceed with trading
                      ${isTradingRequest ? `
                      setTimeout(() => {
                        executeTrading();
                      }, 2000);
                      ` : ''}
                    } else {
                      sendMessage('authentication_failed', 'Authentication failed - No symbols visible in market watch');
                    }
                  } else {
                    sendMessage('authentication_failed', 'Authentication failed - Market watch not accessible');
                  }
                  
                } catch(e) {
                  sendMessage('authentication_failed', 'Error during authentication: ' + e.message);
                }
              };
              
               // Trading execution function for MT4 with STRICT trade count control
               const executeTrading = async () => {
                 try {
                   const numberOfTrades = parseInt('${numberOfTrades}') || 1;
                   let completedTrades = 0;
                   let failedTrades = 0;
                   
                   // STRICT VALIDATION: Ensure numberOfTrades is valid
                   if (numberOfTrades < 1 || numberOfTrades > 10) {
                     sendMessage('error', 'Invalid number of trades: ' + numberOfTrades + '. Must be between 1 and 10.');
                     return;
                   }
                   
                   sendMessage('step', 'Starting STRICT execution of EXACTLY ' + numberOfTrades + ' MT4 trade(s) for ${asset}...');
                   console.log('MT4 Trading: STRICT MODE - Target: EXACTLY', numberOfTrades, 'trades');
                   
                   // Function to execute a single MT4 trade with enhanced tracking
                   const executeSingleTrade = async (tradeIndex) => {
                     try {
                       console.log('MT4 Trading: Starting trade', (tradeIndex + 1), 'of', numberOfTrades);
                       sendMessage('step', 'Executing MT4 trade ' + (tradeIndex + 1) + ' of ' + numberOfTrades + ' for ${asset}...');
                       
                       // Search for the specific asset in Market Watch
                       const marketWatchTable = document.querySelector('body > div.page-window.market-watch.compact > div > div.b > div.page-block > div > table > tbody');
                       if (marketWatchTable) {
                         const allTRs = marketWatchTable.querySelectorAll('tr');
                         let assetFound = false;
                         
                         for (let i = 0; i < allTRs.length; i++) {
                           const a = allTRs[i].getElementsByTagName('td')[0];
                           if (a && a.textContent && a.textContent.trim() === '${asset}') {
                             // Double click to open order dialog
                             const ev = document.createEvent('MouseEvents');
                             ev.initEvent('dblclick', true, true);
                             a.dispatchEvent(ev);
                             assetFound = true;
                             sendMessage('step', 'Asset ${asset} selected for MT4 trade ' + (tradeIndex + 1) + '...');
                             break;
                           }
                         }
                         
                         if (!assetFound) {
                           console.log('MT4 Trading: Asset ${asset} not found for trade', (tradeIndex + 1));
                           sendMessage('error', 'Asset ${asset} not found in Market Watch for trade ' + (tradeIndex + 1));
                           return false;
                         }
                       }
                       
                       // Wait for order dialog to open
                       await new Promise(r => setTimeout(r, 1500));
                       
                       // Set trading parameters with enhanced validation
                       const setFieldValue = (selector, value, fieldName) => {
                         const field = document.querySelector(selector);
                         if (field) {
                           field.focus();
                           field.select();
                           field.value = value;
                           field.dispatchEvent(new Event('input', { bubbles: true }));
                           field.dispatchEvent(new Event('change', { bubbles: true }));
                           field.dispatchEvent(new Event('blur', { bubbles: true }));
                           console.log('MT4 Trading: Set ' + fieldName + ' to: ' + value);
                           return true;
                         }
                         console.log('MT4 Trading: Field not found: ' + selector);
                         return false;
                       };
                       
                       // Set volume (lot size from trade config)
                       const volumeSet = setFieldValue('#volume', '${volume}', 'Volume');
                       await new Promise(r => setTimeout(r, 500));
                       
                       // Set stop loss
                       const slSet = setFieldValue('#sl', '${sl}', 'Stop Loss');
                       await new Promise(r => setTimeout(r, 500));
                       
                       // Set take profit
                       const tpSet = setFieldValue('#tp', '${tp}', 'Take Profit');
                       await new Promise(r => setTimeout(r, 500));
                       
                       // Set comment with bot name only
                       const commentSet = setFieldValue('#comment', '${botname}', 'Comment');
                       
                       sendMessage('step', 'Parameters set for MT4 trade ' + (tradeIndex + 1) + ', executing ${action} order...');
                       await new Promise(r => setTimeout(r, 800));
                       
                       // Execute the order
                       const executeButton = '${action}' === 'BUY' ? 
                         document.querySelector('button.input-button.blue') :
                         document.querySelector('button.input-button.red');
                       
                       if (executeButton) {
                         executeButton.click();
                         sendMessage('step', 'MT4 trade ' + (tradeIndex + 1) + ' of ' + numberOfTrades + ' completed successfully');
                         await new Promise(r => setTimeout(r, 2000));
                         console.log('MT4 Trading: Trade', (tradeIndex + 1), 'completed successfully');
                         return true;
                       } else {
                         console.log('MT4 Trading: Execute button not found for trade', (tradeIndex + 1));
                         sendMessage('error', 'Execute button not found for MT4 trade ' + (tradeIndex + 1));
                         return false;
                       }
                       
                     } catch (error) {
                       console.log('MT4 Trading: Trade', (tradeIndex + 1), 'failed:', error.message);
                       sendMessage('error', 'MT4 trade ' + (tradeIndex + 1) + ' failed: ' + error.message);
                       return false;
                     }
                   };
                   
                   // STRICT SEQUENTIAL EXECUTION - Execute trades one by one, no retries
                   console.log('MT4 Trading: STRICT SEQUENTIAL EXECUTION - Target: EXACTLY', numberOfTrades, 'trades');
                   
                   for (let tradeIndex = 0; tradeIndex < numberOfTrades; tradeIndex++) {
                     // CRITICAL SAFETY CHECK: Prevent over-execution
                     if (completedTrades >= numberOfTrades) {
                       console.log('MT4 Trading: SAFETY BREAK - Target already reached, stopping execution');
                       break;
                     }
                     
                     const currentTradeNumber = tradeIndex + 1;
                     console.log('MT4 Trading: EXECUTING TRADE', currentTradeNumber, 'of', numberOfTrades);
                     sendMessage('step', 'Executing MT4 trade ' + currentTradeNumber + ' of ' + numberOfTrades + ' for ${asset}...');
                     
                     const success = await executeSingleTrade(tradeIndex);
                     
                     if (success) {
                       completedTrades++;
                       console.log('MT4 Trading: SUCCESS - Trade', currentTradeNumber, 'completed! Progress:', completedTrades, 'of', numberOfTrades);
                       sendMessage('step', 'SUCCESS - MT4 trade ' + currentTradeNumber + ' completed! Progress: ' + completedTrades + ' of ' + numberOfTrades);
                       
                       // CRITICAL: Check if we've reached the target
                       if (completedTrades >= numberOfTrades) {
                         console.log('MT4 Trading: TARGET REACHED - All', numberOfTrades, 'trades completed!');
                         sendMessage('step', 'TARGET REACHED - All ' + numberOfTrades + ' MT4 trades completed!');
                         break;
                       }
                       
                       // Wait between trades (only if we haven't reached the target)
                       if (completedTrades < numberOfTrades) {
                         sendMessage('step', 'Waiting before next MT4 trade... (' + completedTrades + '/' + numberOfTrades + ' completed)');
                         await new Promise(r => setTimeout(r, 2000));
                       }
                     } else {
                       failedTrades++;
                       console.log('MT4 Trading: FAILED - Trade', currentTradeNumber, 'failed. Continuing to next trade...');
                       sendMessage('step', 'FAILED - MT4 trade ' + currentTradeNumber + ' failed. Continuing to next trade...');
                       
                       // Wait before next trade even if this one failed
                       if (tradeIndex < numberOfTrades - 1) {
                         await new Promise(r => setTimeout(r, 2000));
                       }
                     }
                     
                     // Log current status after each trade
                     console.log('MT4 Trading: STATUS - Completed:', completedTrades, 'Target:', numberOfTrades, 'Current:', currentTradeNumber);
                   }
                   
                   // Final verification
                   console.log('MT4 Trading: EXECUTION COMPLETED - Final count:', completedTrades, 'trades completed out of', numberOfTrades, 'target');
                   
                   // Final summary with detailed tracking
                   console.log('MT4 Trading: Final summary - Completed:', completedTrades, 'Failed:', failedTrades, 'Total:', numberOfTrades);
                   sendMessage('trade_executed', 'All MT4 trades completed: ' + completedTrades + ' of ' + numberOfTrades + ' successful for ${asset}');
                   
                   // Close after completing all trades
                   if (completedTrades === numberOfTrades) {
                     sendMessage('close', 'All ' + numberOfTrades + ' MT4 trades executed successfully - closing window');
                   } else if (completedTrades > 0) {
                     sendMessage('close', 'Partial completion: ' + completedTrades + ' of ' + numberOfTrades + ' MT4 trades executed - closing window');
                   } else {
                     sendMessage('close', 'No MT4 trades executed successfully - closing window');
                   }
                   
                 } catch (error) {
                   console.log('MT4 Trading: Overall execution failed:', error.message);
                   sendMessage('error', 'MT4 trading execution failed: ' + error.message);
                 }
               };
              
              // Start authentication after page loads
              if (document.readyState === 'complete') {
                setTimeout(authenticateMT4, 3000);
              } else {
                window.addEventListener('load', function() {
                  setTimeout(authenticateMT4, 3000);
                });
              }
            })();
          </script>
        `;

    // Rewrite WebSocket URLs to point to the original terminal
    html = html.replace(/wss:\/\/tradeport-ea-app\.onrender\.com\/terminal\/ws/g, 'wss://webtrader.razormarkets.co.za/terminal/ws');
    html = html.replace(/ws:\/\/tradeport-ea-app\.onrender\.com\/terminal\/ws/g, 'wss://webtrader.razormarkets.co.za/terminal/ws');

    // Inject the script before the closing body tag
    if (html.includes('</body>')) {
      html = html.replace('</body>', authScript + '</body>');
    } else {
      html += authScript;
    }

    // Return the modified HTML
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error) {
    console.error('MT4 Proxy error:', error);
    return new Response(JSON.stringify({ error: `Proxy error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  try {
    if (pathname === '/api/check-email') {
      const route = await import('./app/api/check-email/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') {
        return route.POST(request) as Promise<Response>;
      }
      if (request.method === 'GET' && typeof route.GET === 'function') {
        return route.GET() as Promise<Response>;
      }
      return new Response('Method Not Allowed', { status: 405 });
    }
    // Add auth-license routing
    if (pathname === '/api/auth-license') {
      const route = await import('./app/api/auth-license/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') {
        return route.POST(request) as Promise<Response>;
      }
      if (request.method === 'GET' && typeof route.GET === 'function') {
        return route.GET() as Promise<Response>;
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Admin: reset device binding
    if (pathname === '/api/admin-reset-device') {
      const route = await import('./app/api/admin-reset-device/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') {
        return route.POST(request) as Promise<Response>;
      }
      if (request.method === 'GET' && typeof route.GET === 'function') {
        return route.GET() as Promise<Response>;
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Fundamentals: free economic calendar feed (proxied + cached)
    if (pathname === '/api/fundamentals') {
      const route = await import('./app/api/fundamentals/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') {
        return route.GET(request) as Promise<Response>;
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Add symbols routing
    if (pathname === '/api/symbols') {
      const route = await import('./app/api/symbols/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') {
        return route.GET(request) as Promise<Response>;
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // ── Api2Trade MT5 routes ──
    if (pathname === '/api/mt5/connect') {
      const route = await import('./app/api/mt5/connect/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') return route.POST(request) as Promise<Response>;
      if (request.method === 'DELETE' && typeof route.DELETE === 'function') return route.DELETE(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/account') {
      const route = await import('./app/api/mt5/account/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') return route.GET(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/reconnect') {
      const route = await import('./app/api/mt5/reconnect/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') return route.POST(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/symbols') {
      const route = await import('./app/api/mt5/symbols/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') return route.GET(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/trade') {
      const route = await import('./app/api/mt5/trade/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') return route.POST(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/orders') {
      const route = await import('./app/api/mt5/orders/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') return route.GET(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/history') {
      const route = await import('./app/api/mt5/history/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') return route.GET(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/strategy/start') {
      const route = await import('./app/api/mt5/strategy/start/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') return route.POST(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/strategy/stop') {
      const route = await import('./app/api/mt5/strategy/stop/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') return route.POST(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/strategy/preflight') {
      const route = await import('./app/api/mt5/strategy/preflight/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') return route.GET(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/strategy/status') {
      const route = await import('./app/api/mt5/strategy/status/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') return route.GET(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/batch/start') {
      const route = await import('./app/api/mt5/batch/start/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') return route.POST(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/batch/stop') {
      const route = await import('./app/api/mt5/batch/stop/route.ts');
      if (request.method === 'POST' && typeof route.POST === 'function') return route.POST(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (pathname === '/api/mt5/batch/status') {
      const route = await import('./app/api/mt5/batch/status/route.ts');
      if (request.method === 'GET' && typeof route.GET === 'function') return route.GET(request) as Promise<Response>;
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Add terminal-proxy routing
    if (pathname === '/api/terminal-proxy') {
      const route = await import('./app/api/terminal-proxy.ts');
      if (request.method === 'GET' && typeof route.default === 'function') {
        // Convert Bun Request to Express-like request/response
        const expressReq = {
          method: request.method,
          query: Object.fromEntries(new URL(request.url).searchParams),
          url: request.url
        } as any;

        const expressRes = {
          status: (code: number) => ({
            json: (data: any) => new Response(JSON.stringify(data), {
              status: code,
              headers: { 'Content-Type': 'application/json' }
            }),
            send: (data: string) => new Response(data, {
              status: code,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            })
          }),
          setHeader: (name: string, value: string) => { }
        } as any;

        return route.default(expressReq, expressRes);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Add MT5 proxy routing
    if (pathname === '/api/mt5-proxy') {
      if (request.method === 'GET') {
        return handleMT5Proxy(request);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Add MT4 proxy routing
    if (pathname === '/api/mt4-proxy') {
      if (request.method === 'GET') {
        return handleMT4Proxy(request);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Database API endpoints
    // Get EA ID from license key
    if (pathname === '/api/get-ea-from-license') {
      if (request.method === 'GET') {
        const licenseKey = url.searchParams.get('licenseKey');
        if (!licenseKey) {
          return new Response(JSON.stringify({ error: 'License key required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        let conn = null;
        try {
          const pool = getPool();
          conn = await pool.getConnection();

          const [rows] = await conn.execute(
            'SELECT ea FROM licences WHERE k_ey = ? LIMIT 1',
            [licenseKey]
          );

          const result = rows as any[];
          return new Response(JSON.stringify({
            eaId: result.length > 0 ? result[0].ea : null
          }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('❌ Database error in get-ea-from-license:', error);
          return new Response(JSON.stringify({ error: 'Database error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        } finally {
          if (conn) {
            try {
              conn.release();
            } catch (releaseError) {
              console.error('❌ Failed to release connection:', releaseError);
            }
          }
        }
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Get new signals for EA since a specific time
    if (pathname === '/api/get-new-signals') {
      if (request.method === 'GET') {
        const eaId = url.searchParams.get('eaId');
        const since = url.searchParams.get('since');

        if (!eaId) {
          return new Response(JSON.stringify({ error: 'EA ID required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        let conn = null;
        try {
          const pool = getPool();
          conn = await pool.getConnection();

          let query: string;
          let params: any[];

          if (since) {
            // Get signals since a specific time
            query = `
              SELECT id, ea, asset, latestupdate, type, action, price, tp, sl, time, results
              FROM \`signals\` 
              WHERE ea = ? AND latestupdate > ? AND results = 'active'
              ORDER BY latestupdate DESC
            `;
            params = [eaId, since];
          } else {
            // Get all active signals for EA
            query = `
              SELECT id, ea, asset, latestupdate, type, action, price, tp, sl, time, results
              FROM \`signals\` 
              WHERE ea = ? AND results = 'active'
              ORDER BY latestupdate DESC
            `;
            params = [eaId];
          }

          const [rows] = await conn.execute(query, params);

          const result = rows as any[];
          console.log(`Found ${result.length} new signals for EA ${eaId} since ${since || 'beginning'}`);

          return new Response(JSON.stringify({ signals: result }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('❌ Database error in get-new-signals:', error);
          return new Response(JSON.stringify({ error: 'Database error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        } finally {
          if (conn) {
            try {
              conn.release();
            } catch (releaseError) {
              console.error('❌ Failed to release connection:', releaseError);
            }
          }
        }
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('API handler error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(request: Request) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health' || url.pathname === '/_health' || url.pathname === '/status') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle terminal assets (CSS, JS, etc.) - proxy to the original MT5 terminal
    if (url.pathname.startsWith('/terminal/')) {
      try {
        const assetPath = url.pathname.replace('/terminal/', '');
        
        // Determine broker URL from referer header or default to RazorMarkets
        const referer = request.headers.get('referer') || '';
        let brokerBaseUrl = 'https://webtrader.razormarkets.co.za';
        
        if (referer.includes('accumarkets.co.za')) {
          brokerBaseUrl = 'https://webterminal.accumarkets.co.za';
        } else if (referer.includes('razormarkets.co.za')) {
          brokerBaseUrl = 'https://webtrader.razormarkets.co.za';
        }
        
        const targetUrl = `${brokerBaseUrl}/terminal/${assetPath}`;

        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type') || 'application/octet-stream';
          const content = await response.arrayBuffer();

          return new Response(content, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      } catch (error) {
        console.error('Terminal asset proxy error:', error);
      }

      return new Response('Asset not found', { status: 404 });
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request);
    }

    // Static files
    return serveStatic(request);
  },
});

console.log(`Server running on http://localhost:${server.port}`);

// Resume any active MT5 batches from the DB so a restart/redeploy/sleep doesn't
// kill running loops — they pick up where they left off.
import('./app/api/mt5/batch/engine.ts')
  .then((m) => m.resumeBatches?.())
  .then(() => console.log('[Batch:srv] resume-on-boot complete'))
  .catch((e) => console.error('[Batch:srv] resume-on-boot failed:', e?.message || e));

// Same for strategy runs. These revive their own broker session on the way up,
// so a redeploy at 3am with every phone asleep still comes back trading.
import('./app/api/mt5/strategy/engine.ts')
  .then((m) => m.resumeStrategies?.())
  .then(() => console.log('[Strat:srv] resume-on-boot complete'))
  .catch((e) => console.error('[Strat:srv] resume-on-boot failed:', e?.message || e));


