// 숙소 링크의 미리보기 정보(og:image, og:title)를 읽어 대표사진·방 정보를 채움
// 사용자가 넣은 주소로 서버가 직접 접속하므로 내부망·클라우드 메타데이터 주소 접근(SSRF)을 차단
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9')
    || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

// 연결 직전 DNS 결과를 검사해 DNS 재바인딩으로 내부 주소에 붙는 것도 방지
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some(item => isPrivateAddress(item.address))) return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function fetchHtml(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(url); } catch { return reject(new Error('invalid url')); }
    if (!['http:', 'https:'].includes(target.protocol) || (target.port && !['80', '443'].includes(target.port))) return reject(new Error('unsupported url'));
    if (net.isIP(target.hostname) && isPrivateAddress(target.hostname)) return reject(new Error('blocked address'));
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(target, {
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PICKGO-LinkPreview/1.0)', Accept: 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9' },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('too many redirects'));
        return resolve(fetchHtml(new URL(response.headers.location, target).href, redirects + 1));
      }
      if (response.statusCode !== 200 || !String(response.headers['content-type'] || '').includes('text/html')) {
        response.resume();
        return reject(new Error(`unexpected response ${response.statusCode}`));
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        chunks.push(chunk);
        if (size > MAX_BYTES) { request.destroy(); resolve({ html: Buffer.concat(chunks).toString('utf8'), url: target.href }); }
      });
      response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), url: target.href }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

const decodeEntities = value => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function metaContent(html, property) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (key?.toLowerCase() !== property) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (content) return decodeEntities(content).trim();
  }
  return null;
}

// 에어비앤비 제목 예: "집 · 강릉시 · ★4.98 · 침실 3개 · 침대 3개 · 욕실 2개"
function parseFeatures(text = '') {
  const number = pattern => { const match = text.match(pattern); return match ? Number(match[1]) : null; };
  return {
    bedrooms: number(/침실\s*(\d+)\s*개/) ?? number(/(\d+)\s*bedrooms?/i),
    beds: number(/침대\s*(\d+)\s*개/) ?? number(/(\d+)\s*beds?\b/i),
    bathrooms: number(/욕실\s*(\d+(?:\.\d+)?)\s*개/) ?? number(/(\d+(?:\.\d+)?)\s*(?:private |shared )?baths?/i),
    capacity: number(/최대\s*(?:인원\s*)?(\d+)\s*명/) ?? number(/(\d+)\s*guests?/i),
  };
}

function parsePreview(html, pageUrl) {
  const title = metaContent(html, 'og:title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '';
  let image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  try { image = image ? new URL(image, pageUrl).href : null; } catch { image = null; }
  if (image && (!image.startsWith('https://') || image.length > 1000)) image = null;
  const description = metaContent(html, 'og:description') || '';
  // 제목의 앞 두 덩어리(숙소 유형 · 지역)를 기본 이름으로 제안
  const suggestedName = decodeEntities(title).split(' · ').slice(0, 2).join(' · ').slice(0, 60);
  return { title: decodeEntities(title).slice(0, 200), image, suggestedName, features: parseFeatures(`${title} ${description}`) };
}

async function fetchLinkPreview(url) {
  const { html, url: finalUrl } = await fetchHtml(url);
  return parsePreview(html, finalUrl);
}

module.exports = { fetchLinkPreview, isPrivateAddress, parseFeatures, parsePreview };
