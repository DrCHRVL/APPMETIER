// types/html2pdf.js.d.ts
//
// Shim minimal pour la lib html2pdf.js qui n'embarque pas ses types.
// Le « worker » renvoyé est un thenable chaînable : chaque méthode renvoie
// le worker lui-même, ce qui permet html2pdf().set().from().toPdf().get().then().save().

declare module 'html2pdf.js' {
  interface Html2PdfWorker {
    set(options: Record<string, unknown>): Html2PdfWorker;
    from(element: HTMLElement | string): Html2PdfWorker;
    toPdf(): Html2PdfWorker;
    toCanvas(): Html2PdfWorker;
    toImg(): Html2PdfWorker;
    get(type: string): Html2PdfWorker;
    save(filename?: string): Html2PdfWorker;
    output(type?: string, options?: unknown): Html2PdfWorker;
    then(
      onFulfilled?: (value: any) => unknown,
      onRejected?: (reason: any) => unknown,
    ): Html2PdfWorker;
  }

  function html2pdf(): Html2PdfWorker;
  function html2pdf(element: HTMLElement | string, options?: Record<string, unknown>): Html2PdfWorker;

  export default html2pdf;
}
