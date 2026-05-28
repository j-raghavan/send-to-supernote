import type { HttpClient, HttpRequest, HttpResponse } from '@shared/ports';

type Responder = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

/**
 * Scripted HttpClient fake. Routes responses by a URL substring match and
 * records every request (URL/method/headers/body) so destinations and call
 * order can be asserted (D-3 / I-2). Unmatched requests throw, surfacing a
 * missing stub rather than silently passing.
 */
export class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  private readonly routes: Array<{ match: string; responder: Responder }> = [];

  /** Register a response for any request whose URL contains `match`. */
  on(match: string, responder: Responder | HttpResponse): this {
    const fn: Responder = typeof responder === 'function' ? responder : () => responder;
    this.routes.push({ match, responder: fn });
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const route = this.routes.find((r) => req.url.includes(r.match));
    if (!route) {
      throw new Error(`FakeHttpClient: no stub for ${req.method} ${req.url}`);
    }
    return route.responder(req);
  }

  /** URLs of all recorded requests, in order. */
  get urls(): string[] {
    return this.requests.map((r) => r.url);
  }
}
