const canvas = document.getElementById('planCanvas');
const ctx = canvas.getContext('2d');
const threeContainer = document.getElementById('threeContainer');

let manualEdges = [
    { length: 15, type: 'yol', setback: 3 },
    { length: 12, type: 'komsu', setback: 1.5 },
    { length: 15, type: 'komsu', setback: 1.5 },
    { length: 12, type: 'bitisik', setback: 0 }
];

let currentPolygon = null;
let setbackPolygon = null;
let generatedRooms = [];
let activeMode = '2d';
let scene, camera, renderer, controls;

function resizeCanvas() {
    const parent = document.getElementById('canvasContainer');
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : 420;
    canvas.width = w;
    canvas.height = h;
    if (renderer && camera) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    if (activeMode === '2d') drawScene2D();
}

window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

// Varsayılan Parsel Yükle
document.getElementById('loadDefaultManual').addEventListener('click', () => {
    manualEdges = [
        { length: 16, type: 'yol', setback: 3 },
        { length: 14, type: 'komsu', setback: 1.5 },
        { length: 16, type: 'komsu', setback: 1.5 },
        { length: 14, type: 'bitisik', setback: 0 }
    ];
    initManualParcel();
});

document.getElementById('addEdgeBtn').addEventListener('click', () => {
    manualEdges.push({ length: 10, type: 'komsu', setback: 1.5 });
    initManualParcel();
});

function initManualParcel() {
    renderEdgesUI();
    buildPolygonFromEdges();
}
initManualParcel();

function renderEdgesUI() {
    const container = document.getElementById('edgesList');
    container.innerHTML = '';
    manualEdges.forEach((edge, idx) => {
        const div = document.createElement('div');
        div.className = 'edge-item';
        div.style.cssText = "display:grid; grid-template-columns: 40px 1fr 1fr 45px 30px; gap:4px; align-items:center; margin-bottom:4px; font-size:11px;";
        div.innerHTML = `
            <span><strong>K${idx + 1}</strong></span>
            <input type="number" step="0.5" min="1" value="${edge.length}" onchange="updateEdgeVal(${idx}, 'length', this.value)" title="Kenar Boyu (m)">
            <select onchange="updateEdgeVal(${idx}, 'type', this.value)">
                <option value="yol" ${edge.type === 'yol' ? 'selected' : ''}>Yol (3m)</option>
                <option value="komsu" ${edge.type === 'komsu' ? 'selected' : ''}>Komşu (1.5m)</option>
                <option value="bitisik" ${edge.type === 'bitisik' ? 'selected' : ''}>Bitişik (0m)</option>
            </select>
            <input type="number" step="0.5" min="0" value="${edge.setback}" onchange="updateEdgeVal(${idx}, 'setback', this.value)" title="Çekme Payı">
            <button onclick="removeEdge(${idx})" style="background:#721c24; color:white; border:none; border-radius:4px; cursor:pointer;">×</button>
        `;
        container.appendChild(div);
    });
}

window.updateEdgeVal = (idx, field, val) => {
    manualEdges[idx][field] = field === 'type' ? val : (parseFloat(val) || 0);
    if (field === 'type') {
        manualEdges[idx].setback = val === 'yol' ? 3 : (val === 'komsu' ? 1.5 : 0);
        renderEdgesUI();
    }
    buildPolygonFromEdges();
};

window.removeEdge = (idx) => {
    if (manualEdges.length <= 3) {
        alert("Parsel en az 3 kenarlı olmalıdır!");
        return;
    }
    manualEdges.splice(idx, 1);
    initManualParcel();
};

// Kenar uzunluklarından geometrik poligon üretme (Dikdörtgen/Çokgen Yaklaşımı)
function buildPolygonFromEdges() {
    try {
        let pts = [[0, 0]];
        let currX = 0, currY = 0;
        let angle = 0;

        // Basit ortogonal (dik açılı) veya kapalı poligon üretimi
        for (let i = 0; i < manualEdges.length; i++) {
            const len = manualEdges[i].length;
            if (i === 0) currX += len;
            else if (i === 1) currY += len;
            else if (i === 2) currX -= len;
            else {
                // Kalan kenarları başlangıca kapat
                currY -= len;
            }
            pts.push([currX, currY]);
        }
        pts[pts.length - 1] = pts[0]; // Kapat

        currentPolygon = turf.polygon([pts]);
        updateImarSummary();
        document.getElementById('statusText').innerText = "Parsel hazır. Çekme hesaplayın.";
        drawScene2D();
    } catch (e) {
        console.error(e);
    }
}

function updateImarSummary() {
    if (!currentPolygon) return;
    const area = turf.area(currentPolygon);
    const taks = parseFloat(document.getElementById('taksInput').value) || 0.4;
    document.getElementById('imarOzet').innerText = `Parsel Alanı: ${area.toFixed(1)} m² | Max Taban: ${(area * taks).toFixed(1)} m²`;
}

// Çekme Hesaplama
document.getElementById('calculateBtn').addEventListener('click', () => {
    if (!currentPolygon) return;
    try {
        const coords = currentPolygon.geometry.coordinates[0];
        const offsetLines = coords.slice(0, -1).map((p1, i) => {
            const p2 = coords[(i + 1) % coords.length];
            const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy);
            if (len === 0) return { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] };
            const nx = dy / len, ny = -dx / len;
            const d = manualEdges[i].setback;
            return { x1: p1[0] + nx * d, y1: p1[1] + ny * d, x2: p2[0] + nx * d, y2: p2[1] + ny * d };
        });

        const newPts = offsetLines.map((l2, i) => {
            const l1 = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
            const denom = (l1.x1 - l1.x2) * (l2.y1 - l2.y2) - (l1.y1 - l1.y2) * (l2.x1 - l2.x2);
            if (Math.abs(denom) < 1e-9) return [l2.x1, l2.y1];
            const t = ((l1.x1 - l2.x1) * (l2.y1 - l2.y2) - (l1.y1 - l2.y1) * (l2.x1 - l2.x2)) / denom;
            return [l1.x1 + t * (l1.x2 - l1.x1), l1.y1 + t * (l1.y2 - l1.y1)];
        });
        newPts.push(newPts[0]);

        setbackPolygon = turf.polygon([newPts]);
        updateCoordsTable(newPts);
        document.getElementById('generatePlanBtn').disabled = false;
        document.getElementById('statusText').innerText = "Çekme Sınırı Hesaplandı.";
        drawScene2D();
    } catch (e) {
        alert("Çekme mesafeleri çok büyük!");
    }
});

// Kat Planı Üretimi
document.getElementById('generatePlanBtn').addEventListener('click', () => {
    if (!setbackPolygon) return;
    const totalNet = turf.area(setbackPolygon);
    const type = document.getElementById('daireTipiSelect').value;

    document.getElementById('catalogTitle').innerText = `${type} Katalog`;
    document.getElementById('catalogParcel').innerText = `${document.getElementById('mahalleInput').value} - ${document.getElementById('adaParselInput').value}`;

    generatedRooms = type === '2+1' ? [
        { id: 1, name: "Salon", area: totalNet * 0.32, color: "#e8dcc8", rx: 0, ry: 0.35, rw: 0.55, rh: 0.65 },
        { id: 2, name: "Yatak Odası", area: totalNet * 0.18, color: "#dfcbb2", rx: 0, ry: 0, rw: 0.55, rh: 0.35 },
        { id: 3, name: "Çocuk Odası", area: totalNet * 0.16, color: "#e5d4be", rx: 0.55, ry: 0.48, rw: 0.25, rh: 0.52 },
        { id: 4, name: "Mutfak", area: totalNet * 0.15, color: "#d8dee9", rx: 0.80, ry: 0.48, rw: 0.20, rh: 0.40 },
        { id: 5, name: "Banyo", area: totalNet * 0.06, color: "#cbd5e1", rx: 0.55, ry: 0, rw: 0.25, rh: 0.24 },
        { id: 6, name: "Antre", area: totalNet * 0.08, color: "#cbd5e1", rx: 0.55, ry: 0.24, rw: 0.45, rh: 0.24 },
        { id: 7, name: "Balkon", area: totalNet * 0.05, color: "#94a3b8", rx: 0.80, ry: 0.88, rw: 0.20, rh: 0.12 }
    ] : [
        { id: 1, name: "Salon", area: totalNet * 0.30, color: "#e8dcc8", rx: 0, ry: 0.35, rw: 0.50, rh: 0.65 },
        { id: 2, name: "Ebeveyn Yatak", area: totalNet * 0.18, color: "#dfcbb2", rx: 0, ry: 0, rw: 0.50, rh: 0.35 },
        { id: 3, name: "1. Çocuk Odası", area: totalNet * 0.13, color: "#e5d4be", rx: 0.50, ry: 0.50, rw: 0.25, rh: 0.50 },
        { id: 4, name: "2. Çocuk Odası", area: totalNet * 0.13, color: "#e5d4be", rx: 0.75, ry: 0.50, rw: 0.25, rh: 0.50 },
        { id: 5, name: "Mutfak", area: totalNet * 0.12, color: "#d8dee9", rx: 0.75, ry: 0.22, rw: 0.25, rh: 0.28 },
        { id: 6, name: "Banyo", area: totalNet * 0.06, color: "#cbd5e1", rx: 0.50, ry: 0, rw: 0.25, rh: 0.22 },
        { id: 7, name: "Antre", area: totalNet * 0.08, color: "#cbd5e1", rx: 0.50, ry: 0.22, rw: 0.25, rh: 0.28 }
    ];

    updateRoomsTable(totalNet);
    document.getElementById('mode3dBtn').disabled = false;
    document.getElementById('downloadImgBtn').disabled = false;
    document.getElementById('statusText').innerText = "Plan Hazır!";
    switchMode('2d');
});

function updateRoomsTable(totalNet) {
    const tbody = document.querySelector('#roomsTable tbody');
    tbody.innerHTML = '';
    generatedRooms.forEach(room => {
        tbody.innerHTML += `<tr><td><strong>${room.id}.</strong> ${room.name}</td><td>${room.area.toFixed(2)} m²</td></tr>`;
    });
    document.getElementById('netAlanTxt').innerText = `${totalNet.toFixed(2)} m²`;
    document.getElementById('brutAlanTxt').innerText = `${(totalNet * 1.15).toFixed(2)} m²`;
}

function updateCoordsTable(coords) {
    const tbody = document.querySelector('#coordsTable tbody');
    tbody.innerHTML = '';
    for (let i = 0; i < coords.length - 1; i++) {
        tbody.innerHTML += `<tr><td>B${i + 1}</td><td>${coords[i][0].toFixed(2)}</td><td>${coords[i][1].toFixed(2)}</td></tr>`;
    }
    document.getElementById('exportJsonBtn').disabled = false;
}

function drawScene2D() {
    if (!currentPolygon) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bbox = turf.bbox(currentPolygon);
    const padding = 40;
    const spanX = (bbox[2] - bbox[0]) || 1;
    const spanY = (bbox[3] - bbox[1]) || 1;
    const scale = Math.min((canvas.width - padding * 2) / spanX, (canvas.height - padding * 2) / spanY);
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

    function toScreen(pt) {
        return {
            x: canvas.width / 2 + (pt[0] - center[0]) * scale,
            y: canvas.height / 2 - (pt[1] - center[1]) * scale
        };
    }

    const coords = currentPolygon.geometry.coordinates[0];
    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = toScreen(coords[i]), p2 = toScreen(coords[i + 1]);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = manualEdges[i]?.type === 'yol' ? 4 : 2;
        ctx.strokeStyle = manualEdges[i]?.type === 'yol' ? '#3b82f6' : '#f59e0b';
        ctx.stroke();
    }

    if (setbackPolygon) {
        const sCoords = setbackPolygon.geometry.coordinates[0];
        const screenPts = sCoords.map(toScreen);

        ctx.save();
        ctx.beginPath();
        screenPts.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
        ctx.closePath();
        ctx.fillStyle = "rgba(16, 185, 129, 0.25)";
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#10b981"; ctx.stroke();

        if (generatedRooms.length > 0) {
            ctx.clip();
            const minX = Math.min(...screenPts.map(p => p.x)), maxX = Math.max(...screenPts.map(p => p.x));
            const minY = Math.min(...screenPts.map(p => p.y)), maxY = Math.max(...screenPts.map(p => p.y));
            const w = maxX - minX, h = maxY - minY;

            generatedRooms.forEach(room => {
                const x = minX + room.rx * w, y = minY + room.ry * h;
                const rw = room.rw * w, rh = room.rh * h;
                ctx.fillStyle = room.color; ctx.fillRect(x, y, rw, rh);
                ctx.strokeStyle = "#111827"; ctx.lineWidth = 2; ctx.strokeRect(x, y, rw, rh);

                const cx = x + rw / 2, cy = y + rh / 2;
                ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#111827"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
                ctx.fillText(room.id, cx, cy + 3); ctx.textAlign = "left";
            });
        }
        ctx.restore();
    }
}

document.getElementById('mode2dBtn').addEventListener('click', () => switchMode('2d'));
document.getElementById('mode3dBtn').addEventListener('click', () => switchMode('3d'));

function switchMode(mode) {
    activeMode = mode;
    document.getElementById('mode2dBtn').classList.toggle('active', mode === '2d');
    document.getElementById('mode3dBtn').classList.toggle('active', mode === '3d');
    if (mode === '2d') {
        canvas.style.display = 'block';
        threeContainer.style.display = 'none';
        drawScene2D();
    } else {
        canvas.style.display = 'none';
        threeContainer.style.display = 'block';
        build3DIsometricModel();
    }
}

function build3DIsometricModel() {
    if (typeof THREE === 'undefined') return;
    threeContainer.innerHTML = '';
    const w = threeContainer.clientWidth || 350, h = threeContainer.clientHeight || 400;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);
    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.set(14, 16, 14);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    threeContainer.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const planW = 11, planD = 9, startX = -planW / 2, startZ = -planD / 2;
    generatedRooms.forEach(room => {
        const rw = room.rw * planW, rd = room.rh * planD;
        const cx = startX + room.rx * planW + rw / 2, cz = startZ + room.ry * planD + rd / 2;
        const floor = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.1, 0.15, rd - 0.1), new THREE.MeshStandardMaterial({ color: room.color }));
        floor.position.set(cx, 0.08, cz);
        scene.add(floor);
    });

    function animate() {
        if (activeMode !== '3d') return;
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

document.getElementById('downloadImgBtn').getElementById && document.getElementById('downloadImgBtn').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `TOCO_Plan.png`;
    link.href = activeMode === '2d' ? canvas.toDataURL("image/png") : renderer.domElement.toDataURL("image/png");
    link.click();
});

document.getElementById('exportJsonBtn').addEventListener('click', () => {
    if (!setbackPolygon) return;
    const blob = new Blob([JSON.stringify(setbackPolygon, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = "koordinatlar.geojson"; a.click();
});
