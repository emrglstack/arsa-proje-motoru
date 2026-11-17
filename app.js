const canvas = document.getElementById('planCanvas');
const ctx = canvas.getContext('2d');
const threeContainer = document.getElementById('threeContainer');

let currentPolygon = null;
let setbackPolygon = null;
let edgesData = [];
let generatedRooms = [];
let activeMode = '2d'; // '2d' veya '3d'

// Three.js değişkenleri
let scene, camera, renderer, controls;

const sampleGeoJSON = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "properties": { "mahalle": "Şarköy Mah.", "ada": "142", "parsel": "8" },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [26.968500, 39.498100],
                [26.968680, 39.498110],
                [26.968695, 39.497980],
                [26.968510, 39.497970],
                [26.968500, 39.498100]
            ]]
        }
    }]
};

function resizeCanvas() {
    const parent = document.getElementById('canvasContainer');
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    if (renderer && camera) {
        camera.aspect = parent.clientWidth / parent.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(parent.clientWidth, parent.clientHeight);
    }
    if (activeMode === '2d') drawScene2D();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// GeoJSON Yükleme
document.getElementById('geojsonInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try { loadParcelData(JSON.parse(event.target.result)); }
        catch (err) { alert("Geçersiz GeoJSON dosyası!"); }
    };
    reader.readAsText(file);
});

document.getElementById('loadSampleBtn').addEventListener('click', () => loadParcelData(sampleGeoJSON));

function loadParcelData(geojson) {
    const feature = geojson.type === 'FeatureCollection' ? geojson.features[0] : geojson;
    currentPolygon = feature;
    setbackPolygon = null;
    generatedRooms = [];
    switchMode('2d');

    if (feature.properties) {
        if (feature.properties.mahalle) document.getElementById('mahalleInput').value = feature.properties.mahalle;
        if (feature.properties.ada && feature.properties.parsel) {
            document.getElementById('adaParselInput').value = `${feature.properties.ada} / ${feature.properties.parsel}`;
        }
    }

    const coords = feature.geometry.coordinates[0];
    edgesData = [];
    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = turf.point(coords[i]);
        const p2 = turf.point(coords[i + 1]);
        edgesData.push({
            index: i, start: coords[i], end: coords[i + 1],
            length: turf.distance(p1, p2, { units: 'kilometers' }) * 1000,
            type: i === 0 ? 'yol' : 'komsu',
            setback: i === 0 ? 5 : 3
        });
    }

    renderEdgesUI();
    updateImarSummary();
    document.getElementById('calculateBtn').disabled = false;
    document.getElementById('generatePlanBtn').disabled = true;
    document.getElementById('mode3dBtn').disabled = true;
    document.getElementById('statusText').innerText = "Parsel yüklendi. Çekme hesaplayın.";
    drawScene2D();
}

function renderEdgesUI() {
    const container = document.getElementById('edgesList');
    container.innerHTML = '';
    edgesData.forEach((edge, idx) => {
        const div = document.createElement('div');
        div.className = 'edge-item';
        div.innerHTML = `
            <span><strong>K${idx + 1}</strong><br><small>${edge.length.toFixed(1)}m</small></span>
            <select onchange="updateEdgeType(${idx}, this.value)">
                <option value="yol" ${edge.type === 'yol' ? 'selected' : ''}>Yol Cephesi</option>
                <option value="komsu" ${edge.type === 'komsu' ? 'selected' : ''}>Komşu Parsel</option>
                <option value="bitisik" ${edge.type === 'bitisik' ? 'selected' : ''}>Bitişik (0m)</option>
            </select>
            <input type="number" step="0.5" min="0" value="${edge.setback}" onchange="edgesData[${idx}].setback = parseFloat(this.value)||0">
        `;
        container.appendChild(div);
    });
}

window.updateEdgeType = (idx, val) => {
    edgesData[idx].type = val;
    edgesData[idx].setback = val === 'yol' ? 5 : (val === 'komsu' ? 3 : 0);
    renderEdgesUI();
    drawScene2D();
};

function updateImarSummary() {
    if (!currentPolygon) return;
    const area = turf.area(currentPolygon);
    const taks = parseFloat(document.getElementById('taksInput').value) || 0;
    document.getElementById('imarOzet').innerText = `Parsel: ${area.toFixed(1)} m² | Max Taban: ${(area * taks).toFixed(1)} m²`;
}

// Çekme Hesaplama
document.getElementById('calculateBtn').addEventListener('click', () => {
    if (!currentPolygon) return;
    try {
        const coords = currentPolygon.geometry.coordinates[0];
        const center = turf.center(currentPolygon).geometry.coordinates;
        const mLat = 111320, mLon = 111320 * Math.cos(center[1] * Math.PI / 180);

        let areaSum = 0;
        const localPts = coords.slice(0, -1).map(c => ({ x: (c[0] - center[0]) * mLon, y: (c[1] - center[1]) * mLat }));
        for (let i = 0; i < localPts.length; i++) {
            const j = (i + 1) % localPts.length;
            areaSum += (localPts[j].x - localPts[i].x) * (localPts[j].y + localPts[i].y);
        }
        const isClockwise = areaSum > 0;

        const offsetLines = localPts.map((p1, i) => {
            const p2 = localPts[(i + 1) % localPts.length];
            const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
            const nx = isClockwise ? dy / len : -dy / len;
            const ny = isClockwise ? -dx / len : dx / len;
            const d = edgesData[i].setback;
            return { x1: p1.x + nx * d, y1: p1.y + ny * d, x2: p2.x + nx * d, y2: p2.y + ny * d };
        });

        const newLocalPts = offsetLines.map((l2, i) => {
            const l1 = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
            const denom = (l1.x1 - l1.x2) * (l2.y1 - l2.y2) - (l1.y1 - l1.y2) * (l2.x1 - l2.x2);
            if (Math.abs(denom) < 1e-9) return { x: l2.x1, y: l2.y1 };
            const t = ((l1.x1 - l2.x1) * (l2.y1 - l2.y2) - (l1.y1 - l2.y1) * (l2.x1 - l2.x2)) / denom;
            return { x: l1.x1 + t * (l1.x2 - l1.x1), y: l1.y1 + t * (l1.y2 - l1.y1) };
        });

        const newGeoCoords = newLocalPts.map(p => [center[0] + p.x / mLon, center[1] + p.y / mLat]);
        newGeoCoords.push(newGeoCoords[0]);

        setbackPolygon = turf.polygon([newGeoCoords]);
        updateCoordsTable(newGeoCoords);
        document.getElementById('generatePlanBtn').disabled = false;
        document.getElementById('statusText').innerText = "Çekme sınırı hazır. Plan üretebilirsiniz.";
        drawScene2D();
    } catch (e) {
        alert("Çekme mesafeleri parselden büyük!");
    }
});

// 2D Kat Planı ve Tefriş Üretimi
document.getElementById('generatePlanBtn').addEventListener('click', () => {
    if (!setbackPolygon) return;
    const totalNet = turf.area(setbackPolygon);
    const type = document.getElementById('daireTipiSelect').value;

    document.getElementById('catalogTitle').innerText = `${type} Daire Katalog Özeti`;
    document.getElementById('catalogParcel').innerText = `${document.getElementById('mahalleInput').value} - ${document.getElementById('adaParselInput').value}`;

    if (type === '2+1') {
        generatedRooms = [
            { id: 1, name: "Salon", area: totalNet * 0.32, color: "#e8dcc8", rx: 0, ry: 0.35, rw: 0.55, rh: 0.65, furniture: "sofa" },
            { id: 2, name: "Yatak Odası", area: totalNet * 0.18, color: "#dfcbb2", rx: 0, ry: 0, rw: 0.55, rh: 0.35, furniture: "bed" },
            { id: 3, name: "Çocuk Odası", area: totalNet * 0.16, color: "#e5d4be", rx: 0.55, ry: 0.48, rw: 0.25, rh: 0.52, furniture: "singlebed" },
            { id: 4, name: "Mutfak", area: totalNet * 0.15, color: "#d8dee9", rx: 0.80, ry: 0.48, rw: 0.20, rh: 0.40, furniture: "kitchen" },
            { id: 5, name: "Banyo", area: totalNet * 0.06, color: "#cbd5e1", rx: 0.55, ry: 0, rw: 0.25, rh: 0.24, furniture: "bath" },
            { id: 6, name: "Antre", area: totalNet * 0.08, color: "#cbd5e1", rx: 0.55, ry: 0.24, rw: 0.45, rh: 0.24, furniture: "hall" },
            { id: 7, name: "Balkon", area: totalNet * 0.05, color: "#94a3b8", rx: 0.80, ry: 0.88, rw: 0.20, rh: 0.12, furniture: "balcony" }
        ];
    } else {
        generatedRooms = [
            { id: 1, name: "Salon", area: totalNet * 0.30, color: "#e8dcc8", rx: 0, ry: 0.35, rw: 0.50, rh: 0.65, furniture: "sofa" },
            { id: 2, name: "Ebeveyn Yatak", area: totalNet * 0.18, color: "#dfcbb2", rx: 0, ry: 0, rw: 0.50, rh: 0.35, furniture: "bed" },
            { id: 3, name: "1. Çocuk Odası", area: totalNet * 0.13, color: "#e5d4be", rx: 0.50, ry: 0.50, rw: 0.25, rh: 0.50, furniture: "singlebed" },
            { id: 4, name: "2. Çocuk Odası", area: totalNet * 0.13, color: "#e5d4be", rx: 0.75, ry: 0.50, rw: 0.25, rh: 0.50, furniture: "singlebed" },
            { id: 5, name: "Mutfak", area: totalNet * 0.12, color: "#d8dee9", rx: 0.75, ry: 0.22, rw: 0.25, rh: 0.28, furniture: "kitchen" },
            { id: 6, name: "Banyo", area: totalNet * 0.06, color: "#cbd5e1", rx: 0.50, ry: 0, rw: 0.25, rh: 0.22, furniture: "bath" },
            { id: 7, name: "Antre", area: totalNet * 0.08, color: "#cbd5e1", rx: 0.50, ry: 0.22, rw: 0.25, rh: 0.28, furniture: "hall" }
        ];
    }

    updateRoomsTable(totalNet);
    document.getElementById('mode3dBtn').disabled = false;
    document.getElementById('downloadImgBtn').disabled = false;
    document.getElementById('statusText').innerText = "2D Tefrişli Plan ve 3D Maket Hazır!";
    drawScene2D();
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
        tbody.innerHTML += `<tr><td>B${i + 1}</td><td>${coords[i][0].toFixed(5)}</td><td>${coords[i][1].toFixed(5)}</td></tr>`;
    }
    document.getElementById('exportJsonBtn').disabled = false;
}

// 2D Çizim (Vaziyet + Gerçek Tefrişli Kat Planı)
function drawScene2D() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!currentPolygon) return;

    const bbox = turf.bbox(currentPolygon);
    const padding = 55;
    const latFactor = Math.cos(((bbox[1] + bbox[3]) / 2) * Math.PI / 180);
    const scale = Math.min(
        (canvas.width - padding * 2) / ((bbox[2] - bbox[0]) * latFactor),
        (canvas.height - padding * 2) / (bbox[3] - bbox[1])
    );
    const centerGeo = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

    function toScreen(coord) {
        return {
            x: canvas.width / 2 + (coord[0] - centerGeo[0]) * latFactor * scale,
            y: canvas.height / 2 - (coord[1] - centerGeo[1]) * scale
        };
    }

    // 1. Parsel Sınırları (Yol / Komşu)
    edgesData.forEach(edge => {
        const p1 = toScreen(edge.start), p2 = toScreen(edge.end);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = edge.type === 'yol' ? 5 : 2.5;
        ctx.strokeStyle = edge.type === 'yol' ? '#3b82f6' : '#f59e0b';
        ctx.stroke();

        const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
        ctx.fillStyle = "#9ca3af"; ctx.font = "10px sans-serif";
        ctx.fillText(edge.type === 'yol' ? `YOL (${edge.length.toFixed(1)}m)` : `${edge.length.toFixed(1)}m`, midX - 20, midY - 5);
    });

    // 2. Çekme Sonrası Bina Oturumu
    if (setbackPolygon) {
        const bCoords = setbackPolygon.geometry.coordinates[0];
        const screenPts = bCoords.map(toScreen);

        ctx.save();
        ctx.beginPath();
        screenPts.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
        ctx.closePath();
        ctx.fillStyle = "rgba(16, 185, 129, 0.15)";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#10b981";
        ctx.stroke();

        // Eğer 2D Kat Planı Üretildiyse Poligon İçine Odaları & Mobilya Tefrişlerini Çiz
        if (generatedRooms.length > 0) {
            ctx.clip(); // Odaların bina dış duvarından taşmasını engeller
            const minX = Math.min(...screenPts.map(p => p.x));
            const maxX = Math.max(...screenPts.map(p => p.x));
            const minY = Math.min(...screenPts.map(p => p.y));
            const maxY = Math.max(...screenPts.map(p => p.y));
            const w = maxX - minX;
            const h = maxY - minY;

            generatedRooms.forEach(room => {
                const x = minX + room.rx * w;
                const y = minY + room.ry * h;
                const rw = room.rw * w;
                const rh = room.rh * h;

                // Zemin Parke/Seramik Dolgusu
                ctx.fillStyle = room.color;
                ctx.fillRect(x, y, rw, rh);

                // İç Duvar Çizgileri
                ctx.strokeStyle = "#111827";
                ctx.lineWidth = 3;
                ctx.strokeRect(x, y, rw, rh);

                // Temsili Mobilya Tefrişi (Koltuk, Yatak, Masa)
                drawFurnitureIcon(ctx, room.furniture, x, y, rw, rh);

                // Oda Numarası Yuvarlak Rozeti (1. Görseldeki gibi)
                const cx = x + rw / 2, cy = y + rh / 2;
                ctx.fillStyle = "#ffffff";
                ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = "#111827"; ctx.lineWidth = 1; ctx.stroke();

                ctx.fillStyle = "#111827";
                ctx.font = "bold 10px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(room.id, cx, cy + 3.5);
                ctx.textAlign = "left";
            });
        }
        ctx.restore();
    }
}

function drawFurnitureIcon(ctx, type, x, y, w, h) {
    ctx.fillStyle = "rgba(30, 41, 59, 0.35)";
    if (type === "bed" || type === "singlebed") {
        // Yatak çizimi
        const bw = Math.min(w * 0.55, 42), bh = Math.min(h * 0.55, 48);
        ctx.fillRect(x + 8, y + 8, bw, bh);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x + 11, y + 10, bw - 6, 8); // Yastık
    } else if (type === "sofa") {
        // L Koltuk & Sehpa
        ctx.fillRect(x + 8, y + h * 0.3, 14, h * 0.45);
        ctx.fillRect(x + 8, y + h * 0.65, w * 0.45, 14);
        ctx.fillRect(x + 30, y + h * 0.42, 18, 12); // Orta sehpa
    } else if (type === "kitchen") {
        // Mutfak Tezgahı
        ctx.fillRect(x + w - 14, y + 4, 10, h - 8);
    } else if (type === "bath") {
        // Duşakabin
        ctx.strokeStyle = "rgba(30, 41, 59, 0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 4, y + 4, w * 0.45, h * 0.45);
    }
}

// 2D / 3D Mod Geçişi
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

// 3D İzometrik Maket Oluşturucu (2. Görseldeki Kuşbakışı Kesit Maket)
function build3DIsometricModel() {
    threeContainer.innerHTML = '';
    const w = threeContainer.clientWidth;
    const h = threeContainer.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9); // Katalog beyaz/açık gri zemin

    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.set(14, 16, 14);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    threeContainer.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Işıklar
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.75);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Zemin Tablası (Arsa Tabanı)
    const baseGeo = new THREE.BoxGeometry(16, 0.2, 14);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = -0.1;
    scene.add(baseMesh);

    // Odaları 3D Duvar ve Mobilyalarla Yükselt
    const planW = 11, planD = 9;
    const startX = -planW / 2, startZ = -planD / 2;

    generatedRooms.forEach(room => {
        const rw = room.rw * planW;
        const rd = room.rh * planD;
        const cx = startX + room.rx * planW + rw / 2;
        const cz = startZ + room.ry * planD + rd / 2;

        // Oda Zemini (Parke / Seramik rengi)
        const floorGeo = new THREE.BoxGeometry(rw - 0.1, 0.15, rd - 0.1);
        const floorMat = new THREE.MeshStandardMaterial({ color: room.color });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.set(cx, 0.08, cz);
        scene.add(floor);

        // Kesit Duvarlar (Yarım yükseklikte maket duvarı - 2. görseldeki gibi)
        const wallH = 1.6;
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

        const w1 = new THREE.Mesh(new THREE.BoxGeometry(rw, wallH, 0.12), wallMat);
        w1.position.set(cx, wallH / 2, cz - rd / 2);
        scene.add(w1);

        const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, wallH, rd), wallMat);
        w2.position.set(cx - rw / 2, wallH / 2, cz);
        scene.add(w2);

        // 3D Mobilya Kütleleri (Yatak, Koltuk, Tezgah)
        if (room.furniture === 'bed' || room.furniture === 'singlebed') {
            const bed = new THREE.Mesh(
                new THREE.BoxGeometry(rw * 0.5, 0.45, rd * 0.55),
                new THREE.MeshStandardMaterial({ color: 0x8b5cf6 })
            );
            bed.position.set(cx, 0.35, cz);
            scene.add(bed);
        } else if (room.furniture === 'sofa') {
            const sofa = new THREE.Mesh(
                new THREE.BoxGeometry(rw * 0.55, 0.5, rd * 0.35),
                new THREE.MeshStandardMaterial({ color: 0x475569 })
            );
            sofa.position.set(cx, 0.35, cz);
            scene.add(sofa);
        } else if (room.furniture === 'kitchen') {
            const counter = new THREE.Mesh(
                new THREE.BoxGeometry(rw * 0.7, 0.8, 0.5),
                new THREE.MeshStandardMaterial({ color: 0x1e293b })
            );
            counter.position.set(cx, 0.45, cz - rd * 0.3);
            scene.add(counter);
        }
    });

    function animate() {
        if (activeMode !== '3d') return;
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

// Katalog Görselini PNG Olarak İndir
document.getElementById('downloadImgBtn').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `TOCO_Kat_Plani_${document.getElementById('adaParselInput').value.replace(/\s+/g, '')}.png`;
    link.href = activeMode === '2d' ? canvas.toDataURL("image/png") : renderer.domElement.toDataURL("image/png");
    link.click();
});

// GeoJSON Dışa Aktarma
document.getElementById('exportJsonBtn').addEventListener('click', () => {
    if (!setbackPolygon) return;
    const blob = new Blob([JSON.stringify(setbackPolygon, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "cekme_sonrasi_koordinatlar.geojson";
    a.click();
});
