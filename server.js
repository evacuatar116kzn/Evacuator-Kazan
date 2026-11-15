const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID environment variable.');
  process.exit(1);
}

const rate = new Map();
function sendJson(res, status, body) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 12000) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('Некорректные данные формы')); }
    });
    req.on('error', reject);
  });
}
async function handleOrder(req, res) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const previous = rate.get(ip) || 0;
  if (now - previous < 30000) return sendJson(res, 429, {error:'Подождите немного перед следующей заявкой.'});
  let data;
  try { data = await readBody(req); }
  catch (err) { return sendJson(res, 400, {error:err.message}); }

  const name = String(data.name || '').trim().slice(0, 100);
  const phone = String(data.phone || '').trim().slice(0, 40);
  const car = String(data.car || '').trim().slice(0, 120);
  const route = String(data.route || '').trim().slice(0, 1000);
  if (!name || !phone || data.consent !== 'yes') {
    return sendJson(res, 400, {error:'Укажите имя, телефон и подтвердите согласие.'});
  }
  if (!/[0-9+()\\-\\s]{6,}/.test(phone)) {
    return sendJson(res, 400, {error:'Проверьте номер телефона.'});
  }

  const message = [
    '<b>🚨 Новая заявка — эвакуатор Казань</b>',
    '',
    `<b>Имя:</b> ${escapeHtml(name)}`,
    `<b>Телефон:</b> ${escapeHtml(phone)}`,
    `<b>Автомобиль:</b> ${escapeHtml(car || 'Не указан')}`,
    `<b>Маршрут:</b> ${escapeHtml(route || 'Не указан')}`,
    '',
    `<i>Получено: ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Moscow'})}</i>`
  ].join('\\n');

  try {
    const tg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: CHAT_ID, text: message, parse_mode:'HTML'})
    });
    const result = await tg.json();
    if (!tg.ok || !result.ok) {
      console.error('Telegram API error:', result);
      return sendJson(res, 502, {error:'Не удалось доставить заявку в Telegram. Попробуйте позже.'});
    }
    rate.set(ip, now);
    return sendJson(res, 200, {ok:true});
  } catch (err) {
    console.error('Telegram delivery failed:', err);
    return sendJson(res, 502, {error:'Ошибка соединения. Попробуйте позже.'});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/order') return handleOrder(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, {error:'Method not allowed'});
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, {error:'Forbidden'});
  fs.readFile(file, (err, content) => {
    if (err) return sendJson(res, 404, {error:'Not found'});
    const ext = path.extname(file);
    const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
    res.writeHead(200, {'Content-Type':types[ext] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : content);
  });
});

server.listen(PORT, () => console.log(`Evakuator Kazan listening on ${PORT}`));
