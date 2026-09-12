const { PDFDocument, degrees } = PDFLib;

// pdf.js needs its worker file pointed at explicitly.
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

/* ---------- Tab switching ---------- */
const tabs = document.querySelectorAll(".tool-tab");
const panels = {
  merge: document.getElementById("panel-merge"),
  split: document.getElementById("panel-split"),
  convert: document.getElementById("panel-convert"),
  compress: document.getElementById("panel-compress"),
};
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      t.classList.remove("is-active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    Object.values(panels).forEach((p) => p.classList.remove("is-active"));
    panels[tab.dataset.tool].classList.add("is-active");
  });
});

/* ---------- Convert sub-tab switching ---------- */
const subTabs = document.querySelectorAll(".sub-tab");
const convertPanels = {
  image: document.getElementById("convert-image"),
  word: document.getElementById("convert-word"),
};
subTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    subTabs.forEach((t) => {
      t.classList.remove("is-active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    Object.values(convertPanels).forEach((p) => p.classList.remove("is-active"));
    convertPanels[tab.dataset.convert].classList.add("is-active");
  });
});

/* ---------- Helpers ---------- */
function setupDropzone(zoneEl, inputEl, onFiles) {
  zoneEl.addEventListener("click", () => inputEl.click());
  zoneEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputEl.click(); }
  });
  inputEl.addEventListener("change", () => onFiles(Array.from(inputEl.files)));
  ["dragenter", "dragover"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => { e.preventDefault(); zoneEl.classList.add("is-dragover"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => { e.preventDefault(); zoneEl.classList.remove("is-dragover"); })
  );
  zoneEl.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type === "application/pdf");
    if (files.length) onFiles(files);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Merge ---------- */
let mergeFiles = [];
const dropzoneMerge = document.getElementById("dropzone-merge");
const fileInputMerge = document.getElementById("file-input-merge");
const fileListMerge = document.getElementById("file-list-merge");
const btnMerge = document.getElementById("btn-merge");
const statusMerge = document.getElementById("status-merge");

function renderMergeList() {
  fileListMerge.innerHTML = "";
  mergeFiles.forEach((file, i) => {
    const li = document.createElement("li");
    li.className = "file-row";
    li.innerHTML = `
      <span class="file-name">${file.name}</span>
      <button type="button" data-action="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
      <button type="button" data-action="down" ${i === mergeFiles.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
      <button type="button" data-action="remove" aria-label="Remove">✕</button>
    `;
    li.querySelector('[data-action="up"]').addEventListener("click", () => {
      [mergeFiles[i - 1], mergeFiles[i]] = [mergeFiles[i], mergeFiles[i - 1]];
      renderMergeList();
    });
    li.querySelector('[data-action="down"]').addEventListener("click", () => {
      [mergeFiles[i + 1], mergeFiles[i]] = [mergeFiles[i], mergeFiles[i + 1]];
      renderMergeList();
    });
    li.querySelector('[data-action="remove"]').addEventListener("click", () => {
      mergeFiles.splice(i, 1);
      renderMergeList();
    });
    fileListMerge.appendChild(li);
  });
  btnMerge.disabled = mergeFiles.length < 2;
  statusMerge.textContent = "";
}

setupDropzone(dropzoneMerge, fileInputMerge, (files) => {
  mergeFiles = mergeFiles.concat(files);
  renderMergeList();
});

btnMerge.addEventListener("click", async () => {
  btnMerge.disabled = true;
  statusMerge.textContent = "Merging…";
  try {
    const mergedPdf = await PDFDocument.create();
    for (const file of mergeFiles) {
      const bytes = await file.arrayBuffer();
      const src = await PDFDocument.load(bytes);
      const pages = await mergedPdf.copyPages(src, src.getPageIndices());
      pages.forEach((p) => mergedPdf.addPage(p));
    }
    const outBytes = await mergedPdf.save();
    downloadBlob(new Blob([outBytes], { type: "application/pdf" }), "merged.pdf");
    statusMerge.textContent = "Done — check your downloads.";
  } catch (err) {
    console.error(err);
    statusMerge.textContent = "Something went wrong. Make sure every file is a valid PDF.";
  } finally {
    btnMerge.disabled = mergeFiles.length < 2;
  }
});

/* ---------- Split ---------- */
let splitFile = null;
let splitPageCount = 0;
const dropzoneSplit = document.getElementById("dropzone-split");
const fileInputSplit = document.getElementById("file-input-split");
const fileListSplit = document.getElementById("file-list-split");
const splitOptions = document.getElementById("split-options");
const rangeFrom = document.getElementById("range-from");
const rangeTo = document.getElementById("range-to");
const btnSplit = document.getElementById("btn-split");
const statusSplit = document.getElementById("status-split");

document.querySelectorAll('input[name="split-mode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    document.getElementById("range-inputs").style.opacity =
      document.querySelector('input[name="split-mode"]:checked').value === "range" ? "1" : "0.4";
  });
});
document.getElementById("range-inputs").style.opacity = "0.4";

async function handleSplitFile(file) {
  splitFile = file;
  fileListSplit.innerHTML = `<div class="file-row"><span class="file-name">${file.name}</span></div>`;
  try {
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes);
    splitPageCount = doc.getPageCount();
    rangeFrom.max = splitPageCount;
    rangeTo.max = splitPageCount;
    rangeTo.value = splitPageCount;
    splitOptions.hidden = false;
    btnSplit.disabled = false;
    statusSplit.textContent = `${splitPageCount} page${splitPageCount === 1 ? "" : "s"} detected.`;
  } catch (err) {
    console.error(err);
    statusSplit.textContent = "Couldn't read that file — is it a valid PDF?";
    btnSplit.disabled = true;
  }
}

setupDropzone(dropzoneSplit, fileInputSplit, (files) => {
  if (files[0]) handleSplitFile(files[0]);
});

btnSplit.addEventListener("click", async () => {
  btnSplit.disabled = true;
  const mode = document.querySelector('input[name="split-mode"]:checked').value;
  try {
    const bytes = await splitFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(bytes);
    const baseName = splitFile.name.replace(/\.pdf$/i, "");

    if (mode === "all") {
      statusSplit.textContent = "Splitting…";
      const zip = new JSZip();
      for (let i = 0; i < splitPageCount; i++) {
        const outDoc = await PDFDocument.create();
        const [page] = await outDoc.copyPages(srcDoc, [i]);
        outDoc.addPage(page);
        const outBytes = await outDoc.save();
        zip.file(`${baseName}-page-${i + 1}.pdf`, outBytes);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, `${baseName}-pages.zip`);
      statusSplit.textContent = "Done — check your downloads.";
    } else {
      const from = Math.max(1, parseInt(rangeFrom.value, 10) || 1);
      const to = Math.min(splitPageCount, parseInt(rangeTo.value, 10) || splitPageCount);
      if (from > to) {
        statusSplit.textContent = "The starting page has to come before the ending page.";
        btnSplit.disabled = false;
        return;
      }
      statusSplit.textContent = "Extracting…";
      const outDoc = await PDFDocument.create();
      const indices = [];
      for (let i = from - 1; i <= to - 1; i++) indices.push(i);
      const pages = await outDoc.copyPages(srcDoc, indices);
      pages.forEach((p) => outDoc.addPage(p));
      const outBytes = await outDoc.save();
      downloadBlob(new Blob([outBytes], { type: "application/pdf" }), `${baseName}-p${from}-${to}.pdf`);
      statusSplit.textContent = "Done — check your downloads.";
    }
  } catch (err) {
    console.error(err);
    statusSplit.textContent = "Something went wrong while splitting that file.";
  } finally {
    btnSplit.disabled = false;
  }
});

/* ---------- Convert: Image to PDF ---------- */
let imageFiles = [];
const dropzoneImage = document.getElementById("dropzone-image");
const fileInputImage = document.getElementById("file-input-image");
const fileListImage = document.getElementById("file-list-image");
const btnImageToPdf = document.getElementById("btn-image-to-pdf");
const statusImage = document.getElementById("status-image");

function renderImageList() {
  fileListImage.innerHTML = "";
  imageFiles.forEach((file, i) => {
    const li = document.createElement("li");
    li.className = "file-row";
    li.innerHTML = `
      <span class="file-name">${file.name}</span>
      <button type="button" data-action="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
      <button type="button" data-action="down" ${i === imageFiles.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
      <button type="button" data-action="remove" aria-label="Remove">✕</button>
    `;
    li.querySelector('[data-action="up"]').addEventListener("click", () => {
      [imageFiles[i - 1], imageFiles[i]] = [imageFiles[i], imageFiles[i - 1]];
      renderImageList();
    });
    li.querySelector('[data-action="down"]').addEventListener("click", () => {
      [imageFiles[i + 1], imageFiles[i]] = [imageFiles[i], imageFiles[i + 1]];
      renderImageList();
    });
    li.querySelector('[data-action="remove"]').addEventListener("click", () => {
      imageFiles.splice(i, 1);
      renderImageList();
    });
    fileListImage.appendChild(li);
  });
  btnImageToPdf.disabled = imageFiles.length === 0;
  statusImage.textContent = "";
}

setupDropzone(dropzoneImage, fileInputImage, (files) => {
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  imageFiles = imageFiles.concat(imgs);
  renderImageList();
});

// Loads a File into an HTMLImageElement so we can read its pixel dimensions.
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = reject;
    img.src = url;
  });
}

// Converts any image type to PNG bytes via canvas — used for formats
// pdf-lib can't embed directly (webp, gif, bmp, etc).
function imageElementToPngBytes(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => resolve(new Uint8Array(await blob.arrayBuffer())), "image/png");
  });
}

btnImageToPdf.addEventListener("click", async () => {
  btnImageToPdf.disabled = true;
  statusImage.textContent = "Converting…";
  try {
    const pdfDoc = await PDFDocument.create();
    for (const file of imageFiles) {
      let embedded;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (file.type === "image/jpeg") {
        embedded = await pdfDoc.embedJpg(bytes);
      } else if (file.type === "image/png") {
        embedded = await pdfDoc.embedPng(bytes);
      } else {
        const img = await loadImageElement(file);
        const pngBytes = await imageElementToPngBytes(img);
        embedded = await pdfDoc.embedPng(pngBytes);
      }
      const page = pdfDoc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }
    const outBytes = await pdfDoc.save();
    downloadBlob(new Blob([outBytes], { type: "application/pdf" }), "converted.pdf");
    statusImage.textContent = "Done — check your downloads.";
  } catch (err) {
    console.error(err);
    statusImage.textContent = "Something went wrong. Make sure every file is a valid image.";
  } finally {
    btnImageToPdf.disabled = imageFiles.length === 0;
  }
});

/* ---------- Convert: Word to PDF ---------- */
let wordFile = null;
const dropzoneWord = document.getElementById("dropzone-word");
const fileInputWord = document.getElementById("file-input-word");
const fileListWord = document.getElementById("file-list-word");
const btnWordToPdf = document.getElementById("btn-word-to-pdf");
const statusWord = document.getElementById("status-word");

setupDropzone(dropzoneWord, fileInputWord, (files) => {
  const docx = files.find((f) => f.name.toLowerCase().endsWith(".docx"));
  if (!docx) {
    statusWord.textContent = "Please choose a .docx file.";
    return;
  }
  wordFile = docx;
  fileListWord.innerHTML = `<div class="file-row"><span class="file-name">${docx.name}</span></div>`;
  btnWordToPdf.disabled = false;
  statusWord.textContent = "";
});

// A4 at 96 DPI, matching a typical printable page.
const PAGE_PX_WIDTH = 794;
const PAGE_PX_HEIGHT = 1123;
// A4 in PDF points.
const PAGE_PT_WIDTH = 595.28;
const PAGE_PT_HEIGHT = 841.89;

btnWordToPdf.addEventListener("click", async () => {
  btnWordToPdf.disabled = true;
  statusWord.textContent = "Reading document…";
  let container;
  try {
    const arrayBuffer = await wordFile.arrayBuffer();
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

    // Render the document's HTML off-screen at a fixed page width so we
    // can measure and paginate it accurately.
    container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = `${PAGE_PX_WIDTH}px`;
    container.style.padding = "56px";
    container.style.background = "#ffffff";
    container.style.fontFamily = "Georgia, 'Times New Roman', serif";
    container.style.fontSize = "16px";
    container.style.lineHeight = "1.5";
    container.style.color = "#111111";
    container.innerHTML = html;
    document.body.appendChild(container);

    statusWord.textContent = "Rendering pages…";
    const fullCanvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff" });

    const scaledPageHeight = (PAGE_PX_HEIGHT / PAGE_PX_WIDTH) * fullCanvas.width;
    const pageCount = Math.max(1, Math.ceil(fullCanvas.height / scaledPageHeight));

    const pdfDoc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = fullCanvas.width;
      sliceCanvas.height = scaledPageHeight;
      const ctx = sliceCanvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        fullCanvas,
        0, i * scaledPageHeight, fullCanvas.width, scaledPageHeight,
        0, 0, sliceCanvas.width, scaledPageHeight
      );
      const sliceBlob = await new Promise((res) => sliceCanvas.toBlob(res, "image/png"));
      const sliceBytes = new Uint8Array(await sliceBlob.arrayBuffer());
      const embedded = await pdfDoc.embedPng(sliceBytes);
      const page = pdfDoc.addPage([PAGE_PT_WIDTH, PAGE_PT_HEIGHT]);
      page.drawImage(embedded, { x: 0, y: 0, width: PAGE_PT_WIDTH, height: PAGE_PT_HEIGHT });
    }

    const outBytes = await pdfDoc.save();
    const baseName = wordFile.name.replace(/\.docx$/i, "");
    downloadBlob(new Blob([outBytes], { type: "application/pdf" }), `${baseName}.pdf`);
    statusWord.textContent = "Done — check your downloads.";
  } catch (err) {
    console.error(err);
    statusWord.textContent = "Something went wrong reading that document. Make sure it's a valid .docx file.";
  } finally {
    if (container) container.remove();
    btnWordToPdf.disabled = false;
  }
});

/* ---------- Compress ---------- */
let compressFile = null;
const dropzoneCompress = document.getElementById("dropzone-compress");
const fileInputCompress = document.getElementById("file-input-compress");
const fileListCompress = document.getElementById("file-list-compress");
const compressOptions = document.getElementById("compress-options");
const btnCompress = document.getElementById("btn-compress");
const statusCompress = document.getElementById("status-compress");

const COMPRESS_SETTINGS = {
  high:   { scale: 2.0, quality: 0.82 }, // light compression, best quality
  medium: { scale: 1.5, quality: 0.65 },
  low:    { scale: 1.0, quality: 0.45 }, // strong compression, smallest file
};

setupDropzone(dropzoneCompress, fileInputCompress, (files) => {
  if (!files[0]) return;
  compressFile = files[0];
  fileListCompress.innerHTML = `<div class="file-row"><span class="file-name">${compressFile.name} · ${formatBytes(compressFile.size)}</span></div>`;
  compressOptions.hidden = false;
  btnCompress.disabled = false;
  statusCompress.textContent = "";
});

btnCompress.addEventListener("click", async () => {
  if (!window.pdfjsLib) {
    statusCompress.textContent = "The compression engine failed to load. Try refreshing the page.";
    return;
  }
  btnCompress.disabled = true;
  const level = document.querySelector('input[name="compress-level"]:checked').value;
  const { scale, quality } = COMPRESS_SETTINGS[level];
  try {
    const originalBytes = await compressFile.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: originalBytes.slice(0) });
    const pdf = await loadingTask.promise;

    const outDoc = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      statusCompress.textContent = `Compressing page ${i} of ${pdf.numPages}…`;
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

      const jpegBlob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const embedded = await outDoc.embedJpg(jpegBytes);

      // Keep the output page the same physical size as the original.
      const originalViewport = page.getViewport({ scale: 1 });
      const outPage = outDoc.addPage([originalViewport.width, originalViewport.height]);
      outPage.drawImage(embedded, { x: 0, y: 0, width: originalViewport.width, height: originalViewport.height });
    }

    const outBytes = await outDoc.save();
    const baseName = compressFile.name.replace(/\.pdf$/i, "");
    const newSize = outBytes.byteLength;
    const originalSize = compressFile.size;
    downloadBlob(new Blob([outBytes], { type: "application/pdf" }), `${baseName}-compressed.pdf`);

    if (newSize < originalSize) {
      const savings = Math.round((1 - newSize / originalSize) * 100);
      statusCompress.textContent = `Done — ${formatBytes(originalSize)} → ${formatBytes(newSize)} (${savings}% smaller).`;
    } else {
      statusCompress.textContent = `Done — ${formatBytes(originalSize)} → ${formatBytes(newSize)}. This particular file didn't shrink much (it may already be efficiently encoded); try a stronger setting.`;
    }
  } catch (err) {
    console.error(err);
    statusCompress.textContent = "Something went wrong. Make sure the file is a valid, non-password-protected PDF.";
  } finally {
    btnCompress.disabled = false;
  }
});
