/**
 * ACLED Proxy — Cloudflare Worker
 *
 * DÉPLOIEMENT (3 min) :
 * 1. Va sur https://dash.cloudflare.com/ → Workers & Pages → Create Worker
 * 2. Colle ce code → Deploy
 * 3. Dans Settings → Variables → ajoute deux secrets :
 *      ACLED_USER  = ton email ACLED
 *      ACLED_PASS  = ton mot de passe ACLED
 * 4. Note l'URL du worker (ex: acled-proxy.ton-compte.workers.dev)
 * 5. Dans index.js, mets cette URL dans ACLED_PROXY_URL
 */

export default {
  async fetch(request, env) {
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // On transmet tous les query params ACLED tels quels
    const incoming = new URL(request.url);
    const params = incoming.searchParams;

    try {
      // 1. Obtenir le token OAuth ACLED
      const tokenResp = await fetch('https://acleddata.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username: env.ACLED_USER,
          password: env.ACLED_PASS,
          grant_type: 'password',
          client_id: 'acled'
        })
      });

      if (!tokenResp.ok) {
        return new Response(JSON.stringify({ error: 'ACLED auth failed', status: tokenResp.status }), {
          status: 401,
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }

      const { access_token } = await tokenResp.json();

      // 2. Requête ACLED avec le token
      const acledResp = await fetch(
        `https://acleddata.com/api/acled/read?${params}`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );

      const body = await acledResp.text();

      return new Response(body, {
        status: acledResp.status,
        headers: {
          ...CORS,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600'  // cache 1h côté CDN
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
  }
};
