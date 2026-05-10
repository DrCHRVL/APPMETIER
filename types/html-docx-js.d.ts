// types/html-docx-js.d.ts
//
// Shim minimal pour la lib html-docx-js qui n'embarque pas ses types.
// Suffisant pour notre usage : asBlob(htmlString) renvoie un Blob.

declare module 'html-docx-js/dist/html-docx' {
  export function asBlob(html: string, options?: { orientation?: 'portrait' | 'landscape'; margins?: Record<string, number> }): Blob;
  const _default: { asBlob: typeof asBlob };
  export default _default;
}

declare module 'html-docx-js' {
  export * from 'html-docx-js/dist/html-docx';
}
