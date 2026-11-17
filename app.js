const canvas = document.getElementById('planCanvas');
const ctx = canvas.getContext('2d');

let currentPolygon = null;
let setbackPolygon = null;
let edgesData = [];
let generatedRooms = []; // v0.2 Oda listesi

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
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    drawScene();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

document.getElementById('geojsonInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            loadParcelData(JSON.parse(event.target.result));
        } catch (err) { alert("Geçersiz GeoJSON!"); }
    };
    reader.readAsText(file);
});

document.getElementById('loadSampleBtn').addEventListener('click', () => loadParcelData(sampleGeoJSON));

function loadParcelData(geojson) {
    const feature = geojson.type === 'FeatureCollection' ? geojson.features[0] : geojson;
    currentPolygon = feature;
    setbackPolygon = null;
    generatedRooms = [];

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
    document.getElementById('statusText').innerText = "Parsel yüklendi. Çekme sınırını hesaplayın.";
    drawScene();
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
                <option value="yol" ${edge.type === 'yol' ? 'selected' : ''}>Yol (5m)</option>
                <option value="komsu" ${edge.type === 'komsu' ? 'selected' : ''}>Komşu (3m)</option>
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
    drawScene();
};

function updateImarSummary() {
    if (!currentPolygon) return;
    const area = turf.area(currentPolygon);
    const taks = parseFloat(document.getElementById('taksInput').value) || 0;
    document.getElementById('imarOzet').innerText = `Parsel Alanı: ${area.toFixed(1)} m² | Max Taban: ${(area * taks).toFixed(1)} m²`;
}

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
        document.getElementById('statusText').innerText = "Çekme sınırı hesaplandı. Şimdi kat planı oluşturabilirsiniz.";
        drawScene();
    } catch (e) {
        alert("Çekme mesafeleri çok büyük! Parsel içinde alan kalmadı.");
    }
});

// v0.2: Otomatik Oda Bölme ve Kat Planı Üreticisi
document.getElementById('generatePlanBtn').addEventListener('click', () => {
    if (!setbackPolygon) return;
    const totalNet = turf.area(setbackPolygon);
    const type = document.getElementById('daireTipiSelect').value;

    // Örnek odalandırma oranları (Gönderdiğiniz 1. görseldeki standartlara uygun)
    if (type === '2+1') {
        generatedRooms = [
            { name: "1. Salon", area: totalNet * 0.32 },
            { name: "2. Yatak Odası", area: totalNet * 0.18 },
            { name: "3. Çocuk Odası", area: totalNet * 0.16 },
            { name: "4. Mutfak", area: totalNet * 0.15 },
            { name: "5. Banyo", area: totalNet * 0.06 },
            { name: "6. Antre / Hol", area: totalNet * 0.08 },
            { name: "7. Balkon", area: totalNet * 0.05 }
        ];
    } else {
        generatedRooms = [
            { name: "1. Salon", area: totalNet * 0.30 },
            { name: "2. Ebeveyn Yatak", area: totalNet * 0.18 },
            { name: "3. 1. Çocuk Odası", area: totalNet * 0.12 },
            { name: "4. 2. Çocuk Odası", area: totalNet * 0.12 },
            { name: "5. Mutfak", area: totalNet * 0.13 },
            { name: "6. Banyo + E.Banyo", area: totalNet * 0.07 },
            { name: "7. Antre", area: totalNet * 0.08 }
        ];
    }

    updateRoomsTable(totalNet);
    document.getElementById('statusText').innerText = `${type} Kat Planı ve Oda Yerleşimi Tamamlandı.`;
    drawScene();
});

function updateRoomsTable(totalNet) {
    const tbody = document.querySelector('#roomsTable tbody');
    tbody.innerHTML = '';
    generatedRooms.forEach(room => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${room.name}</td><td><strong>${room.area.toFixed(2)} m²</strong></td>`;
        tbody.appendChild(tr);
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

function drawScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!currentPolygon) return;

    const bbox = turf.bbox(currentPolygon);
    const padding = 60;
    const scale = Math.min((canvas.width - padding * 2) / (bbox[2] - bbox[0]), (canvas.height - padding * 2) / (bbox[3] - bbox[1])) / 111320;
    const centerGeo = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

    function toScreen(coord) {
        return {
            x: canvas.width / 2 + (coord[0] - centerGeo[0]) * 111320 * Math.cos(centerGeo[1] * Math.PI / 180) * scale,
            y: canvas.height / 2 - (coord[1] - centerGeo[1]) * 111320 * scale
        };
    }

    // Parsel kenarları
    edgesData.forEach(edge => {
        const p1 = toScreen(edge.start), p2 = toScreen(edge.end);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = edge.type === 'yol' ? 4 : 2;
        ctx.strokeStyle = edge.type === 'yol' ? '#3b82f6' : '#f59e0b';
        ctx.stroke();
    });

    // Çekme Sınırı & Oda Blokları (Eğer v0.2 üretildiyse)
    if (setbackPolygon) {
        const bCoords = setbackPolygon.geometry.coordinates[0];
        ctx.beginPath();
        bCoords.forEach((c, i) => { const pt = toScreen(c); i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y); });
        ctx.closePath();
        ctx.fillStyle = "rgba(16, 185, 129, 0.15)";
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#10b981"; ctx.stroke();

        // v0.2: İçeride odaları temsil eden şık etiketler göster
        if (generatedRooms.length > 0) {
            const centerPt = toScreen(centerGeo);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 12px sans-serif";
            ctx.fillText("TOCO KAT PLANI (" + document.getElementById('daireTipiSelect').value + ")", centerPt.x - 80, centerPt.y - 20);
            
            generatedRooms.forEach((room, idx) => {
                // Odaları görsel olarak etiketle
                ctx.font = "10px sans-serif";
                ctx.fillStyle = "#10b981";
                // Temsili dağılım konumu
                const rx = centerPt.x + (idx % 2 === 0 ? -50 : 40);
                const ry = centerPt.y + (idx * 16) - 40;
                ctx.fillText(`${room.name}: ${room.area.toFixed(1)}m²`, rx, ry);
            });
        }
    }
}

document.getElementById('exportJsonBtn').addEventListener('click', () => {
    if (!setbackPolygon) return;
    const blob = new Blob([JSON.stringify(setbackPolygon, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = "bina_oturumu_ve_koordinatlar.geojson"; a.click();
});
