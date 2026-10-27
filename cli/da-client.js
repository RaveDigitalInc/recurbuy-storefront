/**
 * Thin client for DA Source API + hlx preview/publish.
 */

const DA_ADMIN = 'https://admin.da.live';
const HLX_ADMIN = 'https://admin.hlx.page';

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {Response} res
 */
async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {{ retries?: number }} [opts]
 */
async function fetchWithRetry(url, init, opts = {}) {
  const retries = opts.retries ?? 3;
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries - 1) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : (2 ** attempt) * 1000;
        await sleep(waitMs);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await sleep((2 ** attempt) * 1000);
        continue;
      }
    }
  }
  throw lastError || new Error(`fetch failed: ${url}`);
}

/**
 * @param {{ token: string, org: string, repo: string, daPath: string }} args
 * `daPath` includes `.html` for documents, e.g. `customer/subscriptions.html`
 */
export async function getDaSource(args) {
  const { token, org, repo, daPath } = args;
  const url = `${DA_ADMIN}/source/${org}/${repo}/${daPath.replace(/^\//, '')}`;
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    return { ok: false, status: 404, body: null };
  }
  const body = await readBody(res);
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  // DA may return HTML string or wrapped JSON depending on Accept; prefer text
  const html = typeof body === 'string' ? body : (body?.html || body?.data || null);
  return { ok: true, status: res.status, body: html ?? body };
}

/**
 * Upload HTML (or other blob) to DA Source. Field name MUST be `data`.
 * @param {{
 *   token: string,
 *   org: string,
 *   repo: string,
 *   daPath: string,
 *   content: string | Buffer,
 *   mime?: string,
 *   fileName?: string,
 * }} args
 */
export async function putDaSource(args) {
  const {
    token,
    org,
    repo,
    daPath,
    content,
    mime = 'text/html',
    fileName,
  } = args;
  const cleanPath = daPath.replace(/^\//, '');
  const url = `${DA_ADMIN}/source/${org}/${repo}/${cleanPath}`;
  const blob = new Blob([content], { type: mime });
  const form = new FormData();
  form.append('data', blob, fileName || cleanPath.split('/').pop() || 'document.html');

  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await readBody(res);
  if (!res.ok) {
    const err = new Error(`DA PUT ${cleanPath} → ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { status: res.status, body };
}

/**
 * Delete a document from DA Source.
 * @param {{ token: string, org: string, repo: string, daPath: string }} args
 */
export async function deleteDaSource(args) {
  const { token, org, repo, daPath } = args;
  const cleanPath = daPath.replace(/^\//, '');
  const url = `${DA_ADMIN}/source/${org}/${repo}/${cleanPath}`;
  const res = await fetchWithRetry(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    return { status: 404, missing: true, body: null };
  }
  const body = await readBody(res);
  if (!res.ok) {
    const err = new Error(`DA DELETE ${cleanPath} → ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { status: res.status, missing: false, body };
}

/**
 * Preview/publish (POST) or unpublish/delete from preview|live (DELETE).
 * @param {{
 *   token: string,
 *   org: string,
 *   repo: string,
 *   branch: string,
 *   pathWithoutHtml: string,
 *   action: 'preview' | 'live',
 *   method?: 'POST' | 'DELETE',
 * }} args
 */
export async function hlxLifecycle(args) {
  const {
    token, org, repo, branch, pathWithoutHtml, action,
    method = 'POST',
  } = args;
  const clean = pathWithoutHtml.replace(/^\//, '').replace(/\.html$/i, '');
  const url = `${HLX_ADMIN}/${action}/${org}/${repo}/${branch}/${clean}`;
  const res = await fetchWithRetry(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (method === 'DELETE' && res.status === 404) {
    return { status: 404, missing: true, body: null };
  }
  const body = await readBody(res);
  if (!res.ok) {
    const err = new Error(`hlx ${method} ${action} ${clean} → ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { status: res.status, missing: false, body };
}

/**
 * @param {{ org: string, repo: string, branch: string, pathWithoutHtml: string }} site
 */
export function publicUrls(site) {
  const p = site.pathWithoutHtml.replace(/^\//, '').replace(/\.html$/i, '');
  return {
    editUrl: `https://da.live/edit#/${site.org}/${site.repo}/${p}`,
    previewUrl: `https://${site.branch}--${site.repo}--${site.org}.aem.page/${p}`,
    liveUrl: `https://${site.branch}--${site.repo}--${site.org}.aem.live/${p}`,
  };
}
