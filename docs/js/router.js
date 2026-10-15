// Routeur minimal basé sur le fragment d'URL (#/...).
const routes = [];
let notFound = null;
let onChange = null;

export function route(pattern, handler, meta = {}) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ re, keys, handler, meta });
}

export function fallback(handler) { notFound = handler; }
export function onRouteChange(fn) { onChange = fn; }

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function navigate(hash, replace = false) {
  if (replace) {
    history.replaceState(null, '', hash);
    resolve();
  } else if (location.hash === hash) {
    resolve();
  } else {
    location.hash = hash;
  }
}

export async function resolve() {
  const { path, params } = parseHash();
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const args = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      onChange?.(r.meta, path);
      await r.handler({ ...args, query: params, path });
      return;
    }
  }
  onChange?.({}, path);
  await notFound?.({ path, query: params });
}

window.addEventListener('hashchange', resolve);
