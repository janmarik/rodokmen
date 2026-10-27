// Globální stav rodokmenu
let persons = {};
let families = {};
let activePersonId = null;

// Stav pro Zoom a Pan
let scale = 0.75;
let panX = 0;
let panY = 0;
let isDragging = false;
let startX = 0, startY = 0;

// Geometrické konstanty mřížky
const CARD_W = 190;
const CARD_H = 70;
const STEP_X = 260; // Pevná vzdálenost sloupců generací

const CZECH_MONTHS = ["", "Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
const GEDCOM_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12
};

window.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initDateDropdowns();
    setupEventListeners();
    setupPanZoom();
    updateEmptyState();
    resetZoom();
});

function initDateDropdowns() {
    ['edit-birthDay', 'edit-deathDay'].forEach(id => {
        const el = document.getElementById(id);
        el.innerHTML = '<option value="">Den</option>';
        for (let i = 1; i <= 31; i++) el.innerHTML += `<option value="${i}">${i}.</option>`;
    });

    ['edit-birthMonth', 'edit-deathMonth'].forEach(id => {
        const el = document.getElementById(id);
        el.innerHTML = '<option value="">Měsíc</option>';
        CZECH_MONTHS.forEach((m, idx) => {
            if (idx > 0) el.innerHTML += `<option value="${idx}">${m}</option>`;
        });
    });
}

function setupEventListeners() {
    document.getElementById('gedcom-file-input').addEventListener('change', handleFileUpload);
    document.getElementById('btn-export-gedcom').addEventListener('click', exportGedcom);
    document.getElementById('btn-export-svg').addEventListener('click', exportSVG);
    document.getElementById('btn-add-person').addEventListener('click', createNewPerson);
    document.getElementById('search-input').addEventListener('input', renderPersonList);

    document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
    document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
    document.getElementById('btn-zoom-reset').addEventListener('click', resetZoom);

    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
    document.getElementById('btn-save-modal').addEventListener('click', savePersonModal);
    document.getElementById('btn-delete-person').addEventListener('click', deleteCurrentPerson);

    document.getElementById('edit-sex').addEventListener('change', updateGenderFields);
    document.getElementById('btn-add-father').addEventListener('click', () => addRelative('father'));
    document.getElementById('btn-add-mother').addEventListener('click', () => addRelative('mother'));
    document.getElementById('btn-add-spouse').addEventListener('click', addSpouse);
}

// Načtení souboru (UTF-8 / Windows-1250)
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const buffer = e.target.result;
        let text = "";

        try {
            const decoderUTF8 = new TextDecoder('utf-8', { fatal: true });
            text = decoderUTF8.decode(buffer);
        } catch (err) {
            const decoderCP1250 = new TextDecoder('windows-1250');
            text = decoderCP1250.decode(buffer);
        }

        try {
            const parsed = parseGedcom(text);
            persons = parsed.persons;
            families = parsed.families;
            const keys = Object.keys(persons);
            
            if (keys.length === 0) {
                alert("Soubor se načetl, ale neobsahuje žádné osoby.");
                return;
            }

            activePersonId = keys[0];
            updateEmptyState();
            renderPersonList();
            renderTree();
            resetZoom();
        } catch (parseErr) {
            console.error("Chyba při parsování GEDCOM:", parseErr);
            alert("Při čtení GEDCOM souboru došlo k chybě.");
        }
    };
    reader.readAsArrayBuffer(file);
}

function parseGedcom(text) {
    const lines = text.split(/\r?\n/);
    const newPersons = {};
    const newFamilies = {};
    let currentRecord = null;
    let currentType = null;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        const match = line.match(/^(\d+)\s+(@[^@]+@|[^\s]+)\s*(.*)$/);
        if (!match) continue;

        const level = parseInt(match[1]);
        const tagOrId = match[2];
        const value = match[3];

        if (level === 0) {
            if (value === 'INDI') {
                currentType = 'INDI';
                currentRecord = { id: tagOrId, givenName: '', surname: '', maidenName: '', sex: 'M', birthDate: '', deathDate: '', famc: null, fams: [] };
                newPersons[tagOrId] = currentRecord;
            } else if (value === 'FAM') {
                currentType = 'FAM';
                currentRecord = { id: tagOrId, husband: null, wife: null, children: [] };
                newFamilies[tagOrId] = currentRecord;
            } else {
                currentType = null; currentRecord = null;
            }
        } else if (currentRecord && level === 1) {
            if (currentType === 'INDI') {
                if (tagOrId === 'NAME') {
                    const nameMatch = value.match(/(.*?)\/(.*?)\//);
                    if (nameMatch) {
                        currentRecord.givenName = nameMatch[1].trim();
                        currentRecord.surname = nameMatch[2].trim();
                    } else {
                        currentRecord.givenName = value.trim();
                    }
                } else if (tagOrId === 'SEX') currentRecord.sex = value.trim().toUpperCase();
                else if (tagOrId === 'FAMC') currentRecord.famc = value.trim();
                else if (tagOrId === 'FAMS') currentRecord.fams.push(value.trim());
                else if (tagOrId === '_MAIDEN' || tagOrId === '_MARNM') currentRecord.maidenName = value.trim();
            } else if (currentType === 'FAM') {
                if (tagOrId === 'HUSB') currentRecord.husband = value.trim();
                if (tagOrId === 'WIFE') currentRecord.wife = value.trim();
                if (tagOrId === 'CHIL') currentRecord.children.push(value.trim());
            }
        }
    }

    let activeRecord = null;
    let lastTag = '';
    for (let line of lines) {
        line = line.trim();
        const match = line.match(/^(\d+)\s+([^\s@]+|@[^@]+@)\s*(.*)$/);
        if (!match) continue;
        const level = parseInt(match[1]);
        const tag = match[2];
        const val = match[3];

        if (level === 0) activeRecord = newPersons[tag] || newFamilies[tag] || null;
        else if (level === 1) lastTag = tag;
        else if (level === 2 && tag === 'DATE' && activeRecord) {
            if (lastTag === 'BIRT') activeRecord.birthDate = val;
            if (lastTag === 'DEAT') activeRecord.deathDate = val;
        }
    }

    Object.values(newPersons).forEach(p => {
        if (p.sex === 'F' && !p.maidenName && p.surname) p.maidenName = p.surname;
    });

    return { persons: newPersons, families: newFamilies };
}

function exportGedcom() {
    let ged = "0 HEAD\n1 SOUR RodokmenStudio\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n";
    Object.values(persons).forEach(p => {
        ged += `0 ${p.id} INDI\n1 NAME ${p.givenName} /${p.surname}/\n`;
        if (p.sex) ged += `1 SEX ${p.sex}\n`;
        if (p.maidenName) ged += `1 _MAIDEN ${p.maidenName}\n`;
        if (p.birthDate) ged += `1 BIRT\n2 DATE ${p.birthDate}\n`;
        if (p.deathDate) ged += `1 DEAT\n2 DATE ${p.deathDate}\n`;
        if (p.famc) ged += `1 FAMC ${p.famc}\n`;
        (p.fams || []).forEach(f => { ged += `1 FAMS ${f}\n`; });
    });
    Object.values(families).forEach(f => {
        ged += `0 ${f.id} FAM\n`;
        if (f.husband) ged += `1 HUSB ${f.husband}\n`;
        if (f.wife) ged += `1 WIFE ${f.wife}\n`;
        (f.children || []).forEach(c => { ged += `1 CHIL ${c}\n`; });
    });
    ged += "0 TRLR\n";

    const blob = new Blob([ged], { type: 'text/plain;charset=utf-8' };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'rodokmen.ged';
    link.click();
}

function renderPersonList() {
    const container = document.getElementById('person-list');
    const search = document.getElementById('search-input').value.toLowerCase();
    document.getElementById('person-count').innerText = Object.keys(persons).length;
    container.innerHTML = '';

    const sorted = Object.values(persons).sort((a,b) => {
        const nameA = `${a.surname} ${a.givenName}`.toLowerCase();
        const nameB = `${b.surname} ${b.givenName}`.toLowerCase();
        return nameA.localeCompare(nameB);
    });

    sorted.forEach(p => {
        const fullName = `${p.givenName} ${p.surname}`.toLowerCase();
        if (search && !fullName.includes(search)) return;

        const isActive = p.id === activePersonId;
        const div = document.createElement('div');
        div.className = `p-3 flex items-center justify-between cursor-pointer transition-all ${
            isActive ? 'bg-slate-950 border-l-4 border-amber-500' : 'hover:bg-slate-950/40'
        }`;
        
        const dates = [formatDisplayDate(p.birthDate), formatDisplayDate(p.deathDate)].filter(Boolean).join(' - ') || 'Bez datumu';
        const maiden = (p.sex === 'F' && p.maidenName) ? ` (${p.maidenName})` : '';

        div.innerHTML = `
            <div class="overflow-hidden pr-2 flex-1" onclick="setActivePerson('${p.id}')">
                <div class="font-medium text-slate-200 text-xs truncate">
                    ${p.givenName || 'Neznámé'} <span class="font-bold text-white">${p.surname || ''}</span>
                    <span class="text-xs text-amber-500/70 font-normal">${maiden}</span>
                </div>
                <div class="text-[10px] text-slate-500 truncate">${dates}</div>
            </div>
            <button onclick="openEditModal('${p.id}'); event.stopPropagation();" class="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-amber-400">
                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

function setActivePerson(id) {
    activePersonId = id;
    renderPersonList();
    renderTree();
}

// --- ABSOLUTNĚ STABILNÍ MŘÍŽKOVÝ VÝPOČET (AHNENTAFEL) ---
function renderTree() {
    const posterHeaderGroup = document.getElementById('poster-header-group');
    const linesGroup = document.getElementById('lines-group');
    const nodesGroup = document.getElementById('nodes-group');

    posterHeaderGroup.innerHTML = '';
    linesGroup.innerHTML = '';
    nodesGroup.innerHTML = '';

    if (!activePersonId || !persons[activePersonId]) return;

    const root = persons[activePersonId];
    renderRoyalPosterHeader(posterHeaderGroup, root);

    const nodes = [];
    const connections = [];
    const marriages = [];

    // 1. Kořenová osoba na středu [0, 0]
    nodes.push({ id: root.id, person: root, x: -CARD_W / 2, y: -CARD_H / 2, isRoot: true });

    // Získáme rodiče kořene
    if (root.famc && families[root.famc]) {
        const fam = families[root.famc];
        
        // Generace 1: Otec (vlevo) a Matka (vpravo)
        let father = fam.husband ? persons[fam.husband] : null;
        let mother = fam.wife ? persons[fam.wife] : null;

        if (father) {
            nodes.push({ id: father.id, person: father, x: -STEP_X - CARD_W / 2, y: -CARD_H - 20 });
            connections.push({ x1: -STEP_X + CARD_W / 2, y1: -CARD_H / 2 - 20, x2: -CARD_W / 2, y2: -CARD_H / 2 });
            
            // Generace 2 pro otce (dědeček a babička z otcovy strany)
            renderAncestorPair(father, -2, -STEP_X * 2, -CARD_H - 120, nodes, connections, marriages);
        }

        if (mother) {
            nodes.push({ id: mother.id, person: mother, x: STEP_X - CARD_W / 2, y: 20 });
            connections.push({ x1: CARD_W / 2, y1: 0, x2: STEP_X - CARD_W / 2, y2: 20 });

            // Generace 2 pro matku (dědeček a babička z matčiny strany)
            renderAncestorPair(mother, 2, STEP_X * 2, CARD_H + 50, nodes, connections, marriages);
        }
    }

    drawGraphics(nodes, connections, marriages, linesGroup, nodesGroup);
}

// Pomocná funkce pro bezpečné vygenerování prarodičů bez přeskakování
function renderAncestorPair(parentPerson, genLevel, posX, centerY, nodes, connections, marriages) {
    if (!parentPerson.famc || !families[parentPerson.famc]) return;
    const fam = families[parentPerson.famc];

    const grandFather = fam.husband ? persons[fam.husband] : null;
    const grandMother = fam.wife ? persons[fam.wife] : null;

    const gF_Y = centerY - 60;
    const gM_Y = centerY + 60;

    if (grandFather) {
        nodes.push({ id: grandFather.id, person: grandFather, x: posX - CARD_W / 2, y: gF_Y });
    }
    if (grandMother) {
        nodes.push({ id: grandMother.id, person: grandMother, x: posX - CARD_W / 2, y: gM_Y });
    }

    if (grandFather && grandMother) {
        // Svislá svorka manželského páru prarodičů
        marriages.push({ x: posX, y1: gF_Y + CARD_H, y2: gM_Y });
        
        // Spojka k rodiči
        const parentTargetX = genLevel < 0 ? posX + CARD_W / 2 : posX - CARD_W / 2;
        const parentTargetY = parentPerson === persons[fam.husband] ? centerY - 30 : centerY + 30;
        connections.push({ x1: posX, y1: (gF_Y + gM_Y + CARD_H) / 2, x2: parentTargetX, y2: parentTargetY });
    }
}

function drawGraphics(nodes, connections, marriages, linesGroup, nodesGroup) {
    marriages.forEach(m => {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", m.x); line.setAttribute("y1", m.y1);
        line.setAttribute("x2", m.x); line.setAttribute("y2", m.y2);
        line.setAttribute("stroke", "#d97706"); line.setAttribute("stroke-width", "2");
        line.setAttribute("stroke-dasharray", "4 3");
        linesGroup.appendChild(line);

        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", m.x); dot.setAttribute("cy", (m.y1 + m.y2) / 2);
        dot.setAttribute("r", "4.5"); dot.setAttribute("fill", "#f59e0b");
        linesGroup.appendChild(dot);
    });

    connections.forEach(c => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const midX = (c.x1 + c.x2) / 2;
        const d = `M ${c.x1} ${c.y1} C ${midX} ${c.y1}, ${midX} ${c.y2}, ${c.x2} ${c.y2}`;
        path.setAttribute("d", d); path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#d97706"); path.setAttribute("stroke-width", "2");
        path.setAttribute("opacity", "0.85");
        linesGroup.appendChild(path);
    });

    nodes.forEach(n => {
        const p = n.person;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform", `translate(${n.x}, ${n.y})`);
        g.setAttribute("class", "person-node-card");
        g.onclick = () => openEditModal(n.id);

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("width", CARD_W); rect.setAttribute("height", CARD_H);
        rect.setAttribute("rx", "12"); rect.setAttribute("fill", "#0f172a");
        rect.setAttribute("stroke", n.isRoot ? "#fbbf24" : "#d97706");
        rect.setAttribute("stroke-width", n.isRoot ? "2.5" : "1.5");
        g.appendChild(rect);

        const badge = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        badge.setAttribute("cx", "22"); badge.setAttribute("cy", "24"); badge.setAttribute("r", "10");
        badge.setAttribute("fill", "#1e293b"); badge.setAttribute("stroke", "#f59e0b"); badge.setAttribute("stroke-width", "1");
        g.appendChild(badge);

        const badgeText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        badgeText.setAttribute("x", "22"); badgeText.setAttribute("y", "28");
        badgeText.setAttribute("text-anchor", "middle"); badgeText.setAttribute("font-size", "10");
        badgeText.setAttribute("font-weight", "bold"); badgeText.setAttribute("fill", "#fbbf24");
        badgeText.textContent = p.sex === 'F' ? '♀' : '♂';
        g.appendChild(badgeText);

        const nameText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        nameText.setAttribute("x", "40"); nameText.setAttribute("y", "24");
        nameText.setAttribute("font-family", "Cinzel, serif"); nameText.setAttribute("font-size", "12");
        nameText.setAttribute("font-weight", "700"); nameText.setAttribute("fill", "#fef3c7");
        
        let fullName = `${p.givenName || ''} ${p.surname || ''}`;
        if (fullName.length > 17) fullName = fullName.substring(0, 15) + '…';
        nameText.textContent = fullName;
        g.appendChild(nameText);

        let currentY = 42;
        if (p.sex === 'F' && p.maidenName) {
            const mText = document.createElementNS("http://www.w3.org/2000/svg", "text");
            mText.setAttribute("x", "40"); mText.setAttribute("y", currentY);
            mText.setAttribute("font-size", "10"); mText.setAttribute("fill", "#f59e0b");
            mText.textContent = `rodná: ${p.maidenName}`;
            g.appendChild(mText);
            currentY += 16;
        }

        const dates = [p.birthDate ? `* ${formatDisplayDate(p.birthDate)}` : '', p.deathDate ? `+ ${formatDisplayDate(p.deathDate)}` : ''].filter(Boolean).join(' ');
        if (dates) {
            const dateText = document.createElementNS("http://www.w3.org/2000/svg", "text");
            dateText.setAttribute("x", "40"); dateText.setAttribute("y", currentY);
            dateText.setAttribute("font-size", "9"); dateText.setAttribute("fill", "#94a3b8");
            dateText.textContent = dates.length > 22 ? dates.substring(0, 20) + '…' : dates;
            g.appendChild(dateText);
        }

        nodesGroup.appendChild(g);
    });
}

function renderRoyalPosterHeader(posterGroup, root) {
    const surname = (root ? root.surname || 'RODINA' : 'RODINA').toUpperCase();

    posterGroup.innerHTML = `
        <rect x="-3500" y="-3500" width="7000" height="7000" fill="#090d16" />
        <rect x="-1600" y="-950" width="3200" height="1900" fill="none" stroke="#d97706" stroke-width="2" opacity="0.3" />
        <rect x="-1585" y="-935" width="3170" height="1870" fill="none" stroke="#f59e0b" stroke-width="1" opacity="0.5" />
        
        <g transform="translate(0, -820)">
            <circle cx="0" cy="0" r="26" fill="none" stroke="#f59e0b" stroke-width="1.5" opacity="0.8" />
            <path d="M0 -32 L5 -8 L28 0 L5 8 L0 32 L-5 8 L-28 0 L-5 -8 Z" fill="#f59e0b" opacity="0.85" />
            <circle cx="0" cy="0" r="3" fill="#090d16" />
            <text x="0" y="48" text-anchor="middle" font-family="Cinzel, serif" font-size="30" font-weight="700" fill="#fef3c7" letter-spacing="4">RODOVÝ STROM RODINY ${surname}</text>
            <text x="0" y="72" text-anchor="middle" font-family="Cinzel, serif" font-size="12" font-weight="500" fill="#f59e0b" letter-spacing="2" opacity="0.8">PŘÍMÁ LINIE PŘEDKŮ | KRÁLOVSKÁ EDICE</text>
        </g>
    `;
}

// Celoplošný Pan & Zoom
function setupPanZoom() {
    const wrapper = document.getElementById('canvas-wrapper');
    const svg = document.getElementById('tree-svg');

    svg.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        updateViewportTransform();
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    wrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
        const newScale = Math.min(Math.max(0.1, scale * zoomFactor), 3);

        const rect = wrapper.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        panX = centerX - (centerX - panX) * (newScale / scale);
        panY = centerY - (centerY - panY) * (newScale / scale);
        scale = newScale;

        updateViewportTransform();
    }, { passive: false });
}

function updateViewportTransform() {
    document.getElementById('viewport').setAttribute('transform', `translate(${panX}, ${panY}) scale(${scale})`);
}

function zoomIn() {
    scale = Math.min(3, scale * 1.25);
    updateViewportTransform();
}

function zoomOut() {
    scale = Math.max(0.1, scale / 1.25);
    updateViewportTransform();
}

function resetZoom() {
    const wrapper = document.getElementById('canvas-wrapper');
    scale = 0.75;
    panX = wrapper.clientWidth / 2;
    panY = wrapper.clientHeight / 2 + 50;
    updateViewportTransform();
}

// Datumy a modální okna
function parseGedcomDate(str) {
    if (!str) return { day: '', month: '', year: '' };
    const parts = str.trim().split(/\s+/);
    let day = '', month = '', year = '';

    parts.forEach(p => {
        const num = parseInt(p);
        const upper = p.toUpperCase();
        if (GEDCOM_MONTHS[upper]) month = GEDCOM_MONTHS[upper];
        else if (!isNaN(num) && num > 19) year = num;
        else if (!isNaN(num) && num <= 31) day = num;
    });

    return { day, month, year };
}

function buildGedcomDate(day, month, year) {
    const gedMonths = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const parts = [];
    if (day) parts.push(day);
    if (month && gedMonths[month]) parts.push(gedMonths[month]);
    if (year) parts.push(year);
    return parts.join(' ');
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const d = parseGedcomDate(dateStr);
    const parts = [];
    if (d.day) parts.push(`${d.day}.`);
    if (d.month && CZECH_MONTHS[d.month]) parts.push(CZECH_MONTHS[d.month]);
    if (d.year) parts.push(d.year);
    return parts.join(' ');
}

function openEditModal(id) {
    const p = persons[id];
    if (!p) return;

    document.getElementById('edit-id').value = p.id;
    document.getElementById('edit-givenName').value = p.givenName || '';
    document.getElementById('edit-surname').value = p.surname || '';
    document.getElementById('edit-sex').value = p.sex || 'M';
    document.getElementById('edit-maidenName').value = p.maidenName || '';

    const bDate = parseGedcomDate(p.birthDate);
    document.getElementById('edit-birthDay').value = bDate.day || '';
    document.getElementById('edit-birthMonth').value = bDate.month || '';
    document.getElementById('edit-birthYear').value = bDate.year || '';

    const dDate = parseGedcomDate(p.deathDate);
    document.getElementById('edit-deathDay').value = dDate.day || '';
    document.getElementById('edit-deathMonth').value = dDate.month || '';
    document.getElementById('edit-deathYear').value = dDate.year || '';

    updateGenderFields();
    document.getElementById('edit-modal').classList.remove('hidden');
}

function updateGenderFields() {
    const sex = document.getElementById('edit-sex').value;
    const container = document.getElementById('maiden-name-container');
    const spouseLabel = document.getElementById('label-add-spouse');

    if (sex === 'F') {
        container.classList.remove('opacity-40', 'pointer-events-none');
        spouseLabel.innerText = "Přidat manžela";
    } else {
        container.classList.add('opacity-40', 'pointer-events-none');
        spouseLabel.innerText = "Přidat manželku";
    }
}

function closeModal() { document.getElementById('edit-modal').classList.add('hidden'); }

function savePersonModal() {
    const id = document.getElementById('edit-id').value;
    if (!persons[id]) return;

    persons[id].givenName = document.getElementById('edit-givenName').value;
    persons[id].surname = document.getElementById('edit-surname').value;
    persons[id].sex = document.getElementById('edit-sex').value;
    persons[id].maidenName = document.getElementById('edit-maidenName').value;

    const bDay = document.getElementById('edit-birthDay').value;
    const bMonth = document.getElementById('edit-birthMonth').value;
    const bYear = document.getElementById('edit-birthYear').value;
    persons[id].birthDate = buildGedcomDate(bDay, bMonth, bYear);

    const dDay = document.getElementById('edit-deathDay').value;
    const dMonth = document.getElementById('edit-deathMonth').value;
    const dYear = document.getElementById('edit-deathYear').value;
    persons[id].deathDate = buildGedcomDate(dDay, dMonth, dYear);

    closeModal();
    renderPersonList();
    renderTree();
}

function createNewPerson() {
    const newId = `@I${Date.now()}@`;
    persons[newId] = { id: newId, givenName: 'Nová', surname: 'Osoba', sex: 'M', maidenName: '', birthDate: '', deathDate: '', famc: null, fams: [] };
    activePersonId = newId;
    updateEmptyState();
    renderPersonList();
    openEditModal(newId);
}

function deleteCurrentPerson() {
    const id = document.getElementById('edit-id').value;
    if (confirm('Opravdu chcete tuto osobu smazat?')) {
        delete persons[id];
        closeModal();
        const keys = Object.keys(persons);
        activePersonId = keys.length > 0 ? keys[0] : null;
        updateEmptyState();
        renderPersonList();
        renderTree();
    }
}

function addRelative(type) {
    const currentId = document.getElementById('edit-id').value;
    const newId = `@I${Date.now()}@`;
    persons[newId] = {
        id: newId,
        givenName: type === 'father' ? 'Otec' : 'Matka',
        surname: persons[currentId].surname || '',
        sex: type === 'mother' ? 'F' : 'M',
        maidenName: '', birthDate: '', deathDate: '', famc: null, fams: []
    };

    let famId = persons[currentId].famc;
    if (!famId) {
        famId = `@F${Date.now()}@`;
        families[famId] = { id: famId, husband: null, wife: null, children: [currentId] };
        persons[currentId].famc = famId;
    }

    if (type === 'father') families[famId].husband = newId;
    if (type === 'mother') families[famId].wife = newId;

    closeModal();
    renderPersonList();
    renderTree();
    openEditModal(newId);
}

function addSpouse() {
    const currentId = document.getElementById('edit-id').value;
    const current = persons[currentId];
    const newId = `@I${Date.now()}@`;
    const spouseSex = current.sex === 'F' ? 'M' : 'F';

    persons[newId] = {
        id: newId,
        givenName: spouseSex === 'M' ? 'Manžel' : 'Manželka',
        surname: current.surname || '',
        sex: spouseSex,
        maidenName: '', birthDate: '', deathDate: '', famc: null, fams: []
    };

    const famId = `@F${Date.now()}@`;
    families[famId] = {
        id: famId,
        husband: spouseSex === 'M' ? newId : currentId,
        wife: spouseSex === 'F' ? newId : currentId,
        children: []
    };

    current.fams.push(famId);
    persons[newId].fams.push(famId);

    closeModal();
    renderPersonList();
    renderTree();
    openEditModal(newId);
}

function updateEmptyState() {
    document.getElementById('empty-state').style.display = Object.keys(persons).length === 0 ? 'flex' : 'none';
}

function exportSVG() {
    const svg = document.getElementById('tree-svg');
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svg);
    if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = "kralovsky_rodokmen.svg";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}
