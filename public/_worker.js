import worker from '../worker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // If it's an API request, handle with backend logic
    if (url.pathname.startsWith('/api/')) {
      return worker.fetch(request, env, ctx);
    }

    // In Cloudflare Pages, env.ASSETS handles static assets
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not Found', { status: 404 });
  }
};
