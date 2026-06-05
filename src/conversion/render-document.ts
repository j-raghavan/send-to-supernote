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
import {
  type OutputFormat,
  type PageSize,
  type RenderOptions,
  resolveRenderOptions,
} from '@domain/conversion';
import { type ImageFetcher, inlineImages } from './inline-images';

export type ConversionErrorKind = 'render-failed';

export interface ConversionError {
  kind: ConversionErrorKind;
  message: string;
}

export interface RenderDeps {
  renderer: Renderer;
  /**
   * Optional network image fetcher (F3-FR4). NOTE: currently unwired in
   * composition — image inlining is now done in-page via canvas at capture time
   * (scripting-extractor + apply-inline-images), so captured HTML already carries
   * `data:` images and this seam stays the `false` arm. Retained as an opt-in
   * fallback for a render that receives HTML with un-inlined remote images.
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
  // Plumb the captured document's REAL title to the renderer so the EPUB heading
  // is the article/page title — never the render context's own document.title
  // (which would leak "Send to Supernote — Offscreen Renderer" into the output).
  const options: RenderOptions = {
    ...resolveRenderOptions(params.format, params.pageSize),
    title: params.document.title,
  };

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
