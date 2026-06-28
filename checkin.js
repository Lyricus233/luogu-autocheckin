const { EnvHttpProxyAgent } = require('undici');

const DIAGNOSTIC = process.env.DIAGNOSTIC === 'true';
const UA = process.env.USER_AGENT || '';
const COOKIE = process.env.LUOGU_COOKIE || '';
const CSRF_OVERRIDE = process.env.LUOGU_CSRF || '';
const BENBEN_SOURCE = process.env.BENBEN_SOURCE || 'none';

const proxyDispatcher = new EnvHttpProxyAgent();

async function getCsrf() {
  if (CSRF_OVERRIDE) return CSRF_OVERRIDE;
  const res = await fetch('https://www.luogu.com.cn/', {
    dispatcher: proxyDispatcher,
    redirect: 'follow',
    headers: {
      cookie: COOKIE,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'user-agent': UA
    }
  });
  console.log('[csrf] res: ', res);
  console.log('[csrf] cf-mitigated:', res.headers.get('cf-mitigated'));
  if (res.headers.get('cf-mitigated') === 'challenge') {
    throw new Error('Cloudflare challenge detected on proxy IP.');
  }
  const html = await res.text();
  const m = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (!m) throw new Error('cannot get csrf from homepage.');
  return m[1];
}

async function checkin(csrf) {
  const res = await fetch('https://www.luogu.com.cn/index/ajax_punch', {
    method: 'POST',
    headers: {
      'origin': 'https://www.luogu.com.cn',
      'referer': 'https://www.luogu.com.cn/',
      'x-csrf-token': csrf,
      'cookie': COOKIE,
      'user-agent': UA
    },
    body: ''
  });
  if (!res.ok) throw new Error(`Failed to checkin: ${res.status}`);
  console.log('[check-in] done.');
}

async function fetchJSON(url, { retry = 2, timeout = 8000 } = {}) {
  let err;
  for (let i = 0; i <= retry; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'accept': 'application/json' },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error('catch error when parsing json');
      }
    } catch (e) {
      clearTimeout(timer);
      err = e;
      if (i < retry) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw err;
}

async function hitokoto() {
  const url = 'https://v1.hitokoto.cn/?c=a&c=b&c=c&c=d&c=e&c=i&c=j&encode=json';
  const json = await fetchJSON(url, { retry: 2, timeout: 8000 });
  const from = json.from || '';
  const who = json.from_who || '';
  return `${json.hitokoto}——${who}《${from}》`;
}

async function jinrishici() {
  const url = 'https://v2.jinrishici.com/one.json';
  const json = await fetchJSON(url, { retry: 2, timeout: 8000 });
  const data = json.data;
  const origin = data.origin;
  return `${data.content}——${origin.author}《${origin.title}》`;
}

async function postBenben(csrf, content) {
  const res = await fetch('https://www.luogu.com.cn/api/feed/postBenben', {
    method: 'POST',
    headers: {
      'origin': 'https://www.luogu.com.cn',
      'referer': 'https://www.luogu.com.cn/',
      'x-csrf-token': csrf,
      'cookie': COOKIE,
      'user-agent': UA
    },
    body: new URLSearchParams({ content: content.trim() })
  });
  // const html = await res.text();
  // console.log(html);
  if (!res.ok) throw new Error(`Failed to post benben: ${res.status}`);
  console.log('[benben] done.');
}

(async () => {
  if (!COOKIE) {
    console.error('missing COOKIE param.');
    process.exit(1);
  }
  try {
    const csrf = await getCsrf();
    if (DIAGNOSTIC) {
      console.log('[diagnostic] skip check-in');
      return;
    }
    await checkin(csrf);
    if (BENBEN_SOURCE === 'jinrishici') {
      const p = await jinrishici();
      console.log('use jinrishici.');
      console.log(p);
      await postBenben(csrf, p);
    } else if (BENBEN_SOURCE === 'hitokoto') {
      const h = await hitokoto();
      console.log('use hitokoto.');
      console.log(h);
      await postBenben(csrf, h);
    }
    console.log('done.');
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  } finally {
    await proxyDispatcher.close();
  }
})();
