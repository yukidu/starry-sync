import app from './aiRouter';
import { handleStarrySyncSso } from './starrySso';

export default {
  async fetch(request: Request, env: any, ctx?: any): Promise<Response> {
    const sso = await handleStarrySyncSso(request, env);
    if (sso) return sso;
    return app.fetch(request, env, ctx);
  },
};
