import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// pdf.js needs a worker. Bundle it locally from the same pdfjs-dist that
// react-pdf depends on (their versions must match exactly, or pdf.js refuses to
// run), never a CDN: the app runs offline behind a null CSP. Vite rewrites this
// URL to a hashed asset at build time.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewProps {
  /** Base64-encoded PDF bytes, as returned by the core host. */
  base64: string;
  /** The file name, used as the document's accessible label. */
  label: string;
}

const OPEN_FALLBACK = 'This PDF could not be rendered here. Open it to view.';

/**
 * Renders a PDF inline with pdf.js (via react-pdf): one canvas per page in a
 * scrolling column. Canvas rendering is identical across the app's webviews,
 * unlike the native <iframe> PDF plugin, which is unreliable in WKWebView.
 */
export default function PdfView({ base64, label }: PdfViewProps) {
  // Decode once. react-pdf reloads the document whenever `file`'s identity
  // changes, so this must be memoised on the base64 payload.
  const file = useMemo(() => ({ data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) }), [base64]);
  const container = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);

  // Measure the well before the first paint, so pages render at their final
  // width straight away. Without this, a fast-parsing PDF can paint a page at
  // its intrinsic size for one frame and then snap out to fit, which reads as
  // a flash. Pages stay unrendered until the width is known (see the guard).
  useLayoutEffect(() => {
    if (container.current) setWidth(container.current.clientWidth);
  }, []);

  return (
    <div className="pdf-view" aria-label={label} ref={container}>
      <Document
        file={file}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={<p className="label">loading...</p>}
        error={<p className="subtle">{OPEN_FALLBACK}</p>}
        noData={<p className="subtle">{OPEN_FALLBACK}</p>}
      >
        {width > 0 &&
          Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i}
              pageNumber={i + 1}
              width={width}
              className="pdf-page"
              loading=""
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          ))}
      </Document>
    </div>
  );
}
