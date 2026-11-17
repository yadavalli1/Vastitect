/** A minimal PDF writer: one page per image, each a JPEG embedded with DCTDecode. No dependencies. */
export interface PdfPage {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
  /** Page size in points; defaults to the image size at 72 dpi scaled to fit A4 landscape width. */
  title?: string;
}

export function writePdf(pages: PdfPage[], info: { title?: string } = {}): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? enc.encode(b) : b;
    chunks.push(bytes);
    size += bytes.length;
  };
  const obj = (n: number, body: (Uint8Array | string)[]) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    for (const b of body) push(b);
    push("\nendobj\n");
  };
  const pdfString = (s: string) => `(${s.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?")})`;
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  const pageIds = pages.map((_, i) => 4 + i * 3);
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`]);
  obj(3, [`<< /Producer (Vastitecture)${info.title ? ` /Title ${pdfString(info.title)}` : ""} >>`]);
  pages.forEach((p, i) => {
    const page = pageIds[i], image = page + 1, content = page + 2;
    // Fit within an A4-landscape-sized page (842 x 595 pt) keeping the aspect ratio, with a margin.
    const scale = Math.min(800 / p.width, 553 / p.height, 1);
    const w = Math.max(1, Math.round(p.width * scale)), h = Math.max(1, Math.round(p.height * scale));
    const pw = w + 42, ph = h + 42;
    obj(page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`]);
    obj(image, [`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, "\nendstream"]);
    const draw = `q ${w} 0 0 ${h} 21 21 cm /Im0 Do Q`;
    obj(content, [`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
  });
  const total = 4 + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) out.set(c, at), (at += c.length);
  return out;
}
