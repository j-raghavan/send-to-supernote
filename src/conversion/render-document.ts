/**
 * RenderDocument use case (F3-FR2/FR3, F4-FR2).
 *
 * Resolves render options for the chosen output format and renders the captured
 * HTML to a blob via the Renderer port (the offscreen adapter). A failed render
 * is retried once; a second failure surfaces an actionable error so the saga
 * fails the job rather than uploading an empty/partial blob (spec Edge Cases).
 * All decision logic lives here (covered); the DOM-bound rendering is the
 * offscreen adapter.
 */
import { err, ok, type Result } from '@shared/result';
import type { Renderer, RenderedBlob } from '@shared/ports';
import type { CapturedDocument } from '@domain/capture';
import { type OutputFormat, type PageSize, resolveRenderOptions } from '@domain/conversion';
import { type ImageFetcher, inlineImages } from './inline-images';

export type ConversionErrorKind = 'render-failed';

export interface ConversionError {
  kind: ConversionErrorKind;
  message: string;
}

export interface RenderDeps {
  renderer: Renderer;
  /**
   * Optional image fetcher. When provided, images are inlined as data URIs and
   * un-fetchable images are skipped before rendering (F3-FR4); when absent, the
   * HTML is rendered as-is.
   */
  fetchImage?: ImageFetcher;
}

export interface RenderParams {
  document: CapturedDocument;
  format: OutputFormat;
  pageSize?: PageSize;
}

/** Render a captured document to a blob, retrying a failed render once. */
export async function renderDocument(
  deps: RenderDeps,
  params: RenderParams,
): Promise<Result<RenderedBlob, ConversionError>> {
  const options = resolveRenderOptions(params.format, params.pageSize);

  const html = deps.fetchImage
    ? (await inlineImages(params.document.html, deps.fetchImage)).html
    : params.document.html;

  const first = await tryRender(deps.renderer, html, options);
  if (first) {
    return ok(first);
  }
  const second = await tryRender(deps.renderer, html, options);
  if (second) {
    return ok(second);
  }
  return err({
    kind: 'render-failed',
    message: 'Could not render the document. Please try again.',
  });
}

async function tryRender(
  renderer: Renderer,
  html: string,
  options: ReturnType<typeof resolveRenderOptions>,
): Promise<RenderedBlob | undefined> {
  try {
    return await renderer.render(html, options);
  } catch {
    return undefined;
  }
}
