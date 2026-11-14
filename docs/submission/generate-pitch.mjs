#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputHtml = path.join(__dirname, 'pitch-deck.html');
const outputPdf = path.join(__dirname, 'familycut-pitch.pdf');

function parseArgs(argv) {
  let renderDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--render-dir' && argv[i + 1]) {
      renderDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return { renderDir };
}

async function generatePdf() {
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox'],
  };
  if (process.env.PW_CHANNEL !== '') {
    launchOptions.channel = process.env.PW_CHANNEL ?? 'chrome';
  }

  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch {
    delete launchOptions.channel;
    browser = await chromium.launch(launchOptions);
  }

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });

    await page.goto(pathToFileURL(inputHtml).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    await page.pdf({
      path: outputPdf,
      width: '13.3333in',
      height: '7.5in',
      printBackground: true,
      margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

function verifyAndRenderWithPdfKit(renderDir) {
  const outDir = renderDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'familycut-pdf-'));
  fs.mkdirSync(outDir, { recursive: true });

  const swiftScript = path.join(outDir, 'verify_pdf.swift');
  const swiftCode = `
import Foundation
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3 else {
  fputs("Usage: verify_pdf.swift <pdfPath> <outDir>\\n", stderr)
  exit(2)
}

let pdfURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])

guard let doc = PDFDocument(url: pdfURL) else {
  fputs("Failed to open PDF\\n", stderr)
  exit(1)
}

print("PAGE_COUNT=\\(doc.pageCount)")

for idx in 0..<doc.pageCount {
  guard let page = doc.page(at: idx) else { continue }
  let bounds = page.bounds(for: .mediaBox)
  let scale: CGFloat = 2.0
  let width = Int(bounds.width * scale)
  let height = Int(bounds.height * scale)

  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  )!
  rep.size = NSSize(width: width, height: height)

  NSGraphicsContext.saveGraphicsState()
  if let ctx = NSGraphicsContext(bitmapImageRep: rep) {
    NSGraphicsContext.current = ctx
    let cg = ctx.cgContext
    cg.setFillColor(NSColor.white.cgColor)
    cg.fill(CGRect(x: 0, y: 0, width: width, height: height))
    cg.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: cg)
  }
  NSGraphicsContext.restoreGraphicsState()

  let pngData = rep.representation(using: .png, properties: [:])!
  let fileName = String(format: "slide-%02d.png", idx + 1)
  try pngData.write(to: outDir.appendingPathComponent(fileName))
  print("PAGE_\\(idx + 1)_BOX=\\(Int(bounds.width))x\\(Int(bounds.height))")
}
`;

  fs.writeFileSync(swiftScript, swiftCode, 'utf8');
  try {
    const output = execFileSync('swift', [swiftScript, outputPdf, outDir], {
      encoding: 'utf8',
    });
    process.stdout.write(output);
    const match = output.match(/PAGE_COUNT=(\d+)/);
    const count = match ? Number(match[1]) : 0;
    if (count < 1 || count > 10) {
      throw new Error(`Expected 1..10 slides in PDF, got ${count}`);
    }
    if (renderDir) {
      console.log(`Rendered ${count} PNG pages to ${outDir}`);
    }
  } finally {
    fs.rmSync(swiftScript, { force: true });
    if (!renderDir) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  const { renderDir } = parseArgs(process.argv.slice(2));
  await generatePdf();
  verifyAndRenderWithPdfKit(renderDir);
  console.log(`Generated ${path.relative(process.cwd(), outputPdf)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
