// --- Initial Setup ---
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
lucide.createIcons();

let currentPdfDoc = null;
let selectedPages = new Set();
let draggedItem = null; 

// --- Core Functions ---

async function handleUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    showLoader("Loading PDF...");
    try {
        const arrayBuffer = await file.arrayBuffer();
        currentPdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        clearSelection();
        await renderGrid();
        updateUIState(true);
        showToast("PDF loaded successfully");
    } catch (err) {
        console.error(err);
        showToast("Error loading PDF. Is it encrypted?", "error");
    }
    hideLoader();
    event.target.value = '';
}

async function handleMerge(event) {
    const file = event.target.files[0];
    if (!file || !currentPdfDoc) return;

    showLoader("Merging documents...");
    try {
        const arrayBuffer = await file.arrayBuffer();
        const newPdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        
        const copiedPages = await currentPdfDoc.copyPages(newPdfDoc, newPdfDoc.getPageIndices());
        copiedPages.forEach((page) => currentPdfDoc.addPage(page));
        
        clearSelection(); 
        await renderGrid();
        showToast(`Added ${copiedPages.length} pages`, "success");
    } catch (err) {
        console.error(err);
        showToast("Error merging PDF.", "error");
    }
    hideLoader();
    event.target.value = '';
}

function updateUIState(hasPdf) {
    if (hasPdf) {
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('pagesGrid').classList.remove('hidden');
        document.getElementById('mergeBtn').classList.remove('hidden');
        document.getElementById('downloadBtn').classList.remove('hidden');
        document.getElementById('selectAllBtn').classList.remove('hidden');
        document.getElementById('uploadText').innerText = "Upload New";
    }
}

// --- Selection Logic ---

function toggleSelection(index) {
    const card = document.getElementById(`card-index-${index}`);
    const checkbox = card.querySelector('.custom-checkbox');
    
    if (selectedPages.has(index)) {
        selectedPages.delete(index);
        card.classList.remove('selected');
        checkbox.checked = false;
    } else {
        selectedPages.add(index);
        card.classList.add('selected');
        checkbox.checked = true;
    }
    updateSelectionHeader();
}

function toggleSelectAll() {
    if (!currentPdfDoc) return;
    const cards = document.querySelectorAll('.pdf-page-card');
    
    if (selectedPages.size === cards.length) {
        clearSelection();
    } else {
        cards.forEach(card => {
            const idx = parseInt(card.getAttribute('data-original-index'));
            selectedPages.add(idx);
            card.classList.add('selected');
            card.querySelector('.custom-checkbox').checked = true;
        });
    }
    updateSelectionHeader();
}

function clearSelection() {
    selectedPages.clear();
    document.querySelectorAll('.pdf-page-card').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.custom-checkbox').forEach(c => c.checked = false);
    updateSelectionHeader();
}

function updateSelectionHeader() {
    const headerActions = document.getElementById('defaultHeaderActions');
    const selectActions = document.getElementById('selectionActions');
    const countSpan = document.getElementById('selectedCount');
    
    countSpan.innerText = selectedPages.size;

    if (selectedPages.size > 0) {
        headerActions.classList.add('hidden');
        selectActions.classList.remove('hidden');
        selectActions.classList.add('flex');
    } else {
        headerActions.classList.remove('hidden');
        selectActions.classList.add('hidden');
        selectActions.classList.remove('flex');
    }
}

// --- Live Sorting Drag & Drop Logic ---

function handleDragStart(e) {
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        e.preventDefault();
        return;
    }

    draggedItem = e.target.closest('.pdf-page-card');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedItem.getAttribute('data-original-index'));
    
    if (selectedPages.size > 0) {
        clearSelection();
        showToast("Selection cleared for reorder", "success");
    }

    requestAnimationFrame(() => {
        if (draggedItem) draggedItem.classList.add('dragging');
    });
}

function handleDragOver(e) {
    e.preventDefault(); 
    const container = document.getElementById('pagesGrid');
    const target = e.target.closest('.pdf-page-card');

    if (target && target !== draggedItem && draggedItem) {
        const children = Array.from(container.children);
        const draggedIndex = children.indexOf(draggedItem);
        const targetIndex = children.indexOf(target);

        if (draggedIndex < targetIndex) {
            container.insertBefore(draggedItem, target.nextSibling);
        } else {
            container.insertBefore(draggedItem, target);
        }
    }
}

async function handleDrop(e) {
    e.preventDefault();
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
        await updatePdfOrderFromDom();
    }
}

function handleDragEnd(e) {
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
    }
}

async function updatePdfOrderFromDom() {
    // Updated Logic: We do NOT re-render the grid to avoid flickering.
    // Instead, we update the attributes of the existing DOM elements.
    
    try {
        const grid = document.getElementById('pagesGrid');
        const cards = Array.from(grid.children);
        
        // 1. Get new order from DOM
        const newOrderIndices = cards.map(card => parseInt(card.getAttribute('data-original-index')));
        
        // 2. Create new PDF
        const newPdfDoc = await PDFLib.PDFDocument.create();
        const copiedPages = await newPdfDoc.copyPages(currentPdfDoc, newOrderIndices);
        
        copiedPages.forEach(page => newPdfDoc.addPage(page));
        currentPdfDoc = newPdfDoc; // Update global state

        // 3. Update DOM attributes to match new reality
        cards.forEach((card, index) => {
            // Update index attribute so future interactions reference correct page
            card.setAttribute('data-original-index', index);
            
            // Update ID to match new index
            card.id = `card-index-${index}`;

            // Update visual Label
            const label = card.querySelector('.page-label');
            if (label) label.innerText = `Page ${index + 1}`;
        });
        
        showToast("Page reordered");

    } catch (err) {
        console.error("Reorder failed", err);
        showToast("Reorder failed", "error");
    }
}


// --- Actions (Delete & Download) ---

let deleteAction = null;

function promptDeleteSelected() {
    if (selectedPages.size === 0) return;
    setupModal(
        `Delete ${selectedPages.size} Page(s)?`, 
        "These pages will be removed from your document.", 
        executeBatchDelete
    );
}

function promptSingleDelete(originalIndex) {
    setupModal(
        `Delete Page?`, 
        "This cannot be undone.", 
        () => executeSingleDelete(originalIndex)
    );
}

function setupModal(title, desc, action) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalDesc').innerText = desc;
    deleteAction = action;
    
    const modal = document.getElementById('confirmModal');
    const content = document.getElementById('confirmModalContent');
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
    
    document.getElementById('confirmDeleteBtn').onclick = () => {
        if(deleteAction) deleteAction();
        closeConfirmModal();
    };
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    const content = document.getElementById('confirmModalContent');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        deleteAction = null;
    }, 200);
}

async function executeSingleDelete(originalIndex) {
    showLoader("Deleting page...");
    try {
        currentPdfDoc.removePage(originalIndex);
        clearSelection(); 
        await renderGrid();
        showToast("Page deleted");
    } catch (err) {
        console.error(err);
        showToast("Error deleting page", "error");
    }
    hideLoader();
}

async function executeBatchDelete() {
    showLoader("Removing pages...");
    try {
        const newPdfDoc = await PDFLib.PDFDocument.create();
        const total = currentPdfDoc.getPageCount();
        const keepIndices = [];

        for (let i = 0; i < total; i++) {
            if (!selectedPages.has(i)) keepIndices.push(i);
        }

        if (keepIndices.length > 0) {
            const copiedPages = await newPdfDoc.copyPages(currentPdfDoc, keepIndices);
            copiedPages.forEach(p => newPdfDoc.addPage(p));
        }
        
        currentPdfDoc = newPdfDoc;
        clearSelection();
        await renderGrid();
        showToast("Pages removed");
    } catch (err) {
        console.error(err);
        showToast("Batch delete failed", "error");
    }
    hideLoader();
}

async function downloadSelected() {
    if (selectedPages.size === 0) return;
    showLoader("Extracting pages...");
    try {
        const newPdfDoc = await PDFLib.PDFDocument.create();
        const indices = Array.from(selectedPages).sort((a, b) => a - b);
        
        const copiedPages = await newPdfDoc.copyPages(currentPdfDoc, indices);
        copiedPages.forEach(p => newPdfDoc.addPage(p));
        
        const pdfBytes = await newPdfDoc.save();
        triggerDownload(pdfBytes, `extracted_pages_${Date.now()}.pdf`);
        showToast("Pages extracted & downloaded");
    } catch (err) {
        console.error(err);
        showToast("Extraction failed", "error");
    }
    hideLoader();
}

async function downloadPDF() {
    if (!currentPdfDoc) return;
    showLoader("Generating PDF...");
    try {
        const pdfBytes = await currentPdfDoc.save();
        triggerDownload(pdfBytes, `full_document_${Date.now()}.pdf`);
        showToast("Download started!");
    } catch (err) {
        showToast("Error saving PDF", "error");
    }
    hideLoader();
}

function triggerDownload(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
}

// --- Rendering ---

async function renderGrid() {
    const grid = document.getElementById('pagesGrid');
    grid.innerHTML = '';
    
    if (!currentPdfDoc || currentPdfDoc.getPageCount() === 0) {
        updateUIState(false);
        return;
    }

    const pdfBytes = await currentPdfDoc.save();
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const pdf = await loadingTask.promise;
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const index = i - 1; // 0-based index
        const isSelected = selectedPages.has(index);

        // Card Wrapper
        const card = document.createElement('div');
        card.id = `card-index-${index}`;
        // Store original index to map back to PDF page
        card.setAttribute('data-original-index', index);
        
        card.className = `pdf-page-card bg-white p-3 rounded-xl shadow-sm border border-slate-200 relative group fade-in ${isSelected ? 'selected' : ''}`;
        card.setAttribute('draggable', 'true');
        
        // Native Drag Events
        card.ondragstart = handleDragStart;
        card.ondragover = handleDragOver;
        card.ondrop = handleDrop;
        card.ondragend = handleDragEnd;

        // --- DYNAMIC EVENT HANDLERS ---
        // We fetch the attribute at CLICK time, ensuring we always get the updated index
        // even after reordering without re-rendering.
        
        card.onclick = (e) => {
            if (!e.target.closest('button') && !e.target.closest('input')) {
                const currentIdx = parseInt(card.getAttribute('data-original-index'));
                toggleSelection(currentIdx);
            }
        };

        const header = document.createElement('div');
        header.className = "flex justify-between items-center mb-2 px-1 relative z-10";

        const leftCol = document.createElement('div');
        leftCol.className = "flex items-center gap-2";

        const checkbox = document.createElement('input');
        checkbox.type = "checkbox";
        checkbox.className = "custom-checkbox";
        checkbox.checked = isSelected;
        checkbox.onclick = (e) => {
            e.stopPropagation(); 
            const currentIdx = parseInt(card.getAttribute('data-original-index'));
            toggleSelection(currentIdx);
        };

        const label = document.createElement('span');
        label.className = "page-label text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded";
        label.innerText = `Page ${i}`;

        leftCol.appendChild(checkbox);
        leftCol.appendChild(label);

        const delBtn = document.createElement('button');
        delBtn.className = "text-slate-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition-colors";
        delBtn.innerHTML = `<i data-lucide="trash-2" class="w-4 h-4"></i>`;
        delBtn.onclick = (e) => {
            e.stopPropagation();
            const currentIdx = parseInt(card.getAttribute('data-original-index'));
            promptSingleDelete(currentIdx);
        };

        header.appendChild(leftCol);
        header.appendChild(delBtn);
        card.appendChild(header);

        const canvasContainer = document.createElement('div');
        canvasContainer.className = "relative w-full bg-slate-100 rounded overflow-hidden flex items-center justify-center min-h-[200px] pointer-events-none"; 
        
        const placeholder = document.createElement('div');
        placeholder.className = "absolute inset-0 flex items-center justify-center text-slate-300";
        placeholder.innerHTML = `<i data-lucide="image" class="w-8 h-8"></i>`;
        canvasContainer.appendChild(placeholder);

        const canvas = document.createElement('canvas');
        canvas.className = "max-w-full h-auto shadow-sm";
        canvasContainer.appendChild(canvas);
        
        card.appendChild(canvasContainer);
        grid.appendChild(card);

        renderPageToCanvas(pdf, i, canvas, placeholder);
    }
    lucide.createIcons();
}

async function renderPageToCanvas(pdf, pageNum, canvas, placeholder) {
    try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 0.5 }); 
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        placeholder.remove();
    } catch (err) { console.error(err); }
}

// --- Utilities ---
function showLoader(text) {
    document.getElementById('loaderText').innerText = text;
    document.getElementById('loader').classList.remove('hidden');
}
function hideLoader() { document.getElementById('loader').classList.add('hidden'); }
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const msg = document.getElementById('toastMessage');
    msg.innerText = message;
    
    icon.className = type === 'error' ? "w-5 h-5 text-red-400" : "w-5 h-5 text-emerald-400";
    icon.setAttribute('data-lucide', type === 'error' ? 'alert-circle' : 'check-circle');
    lucide.createIcons();

    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
}