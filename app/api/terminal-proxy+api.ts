export async function GET(request: Request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  const script = url.searchParams.get('script');

  if (!targetUrl) {
    return Response.json({ error: 'Missing URL parameter' }, { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
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

    if (script) {
      const decodedScript = decodeURIComponent(script);

      const injectionScript = `
        <script>
          (function() {
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
          })();

          window.addEventListener('load', function() {
            setTimeout(function() {
              try {
                console.log('Executing injected script...');
                ${decodedScript}
              } catch (error) {
                console.error('Script injection error:', error);
              }
            }, 2000);
          });
        </script>
      `;

      if (html.includes('</body>')) {
        html = html.replace('</body>', injectionScript + '</body>');
      } else {
        html += injectionScript;
      }
    }

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });

  } catch (error: any) {
    console.error('Proxy error:', error);
    return Response.json({ error: `Proxy error: ${error.message}` }, { status: 500 });
  }
}
