const canvas = document.getElementById('planCanvas');
const ctx = canvas.getContext('2d');

let currentPolygon = null; // Turf Polygon
let setbackPolygon = null; // Çekme sonrası poligon
let edgesData = []; // Kenar bilgileri (tip: yol/komsu, cekme: metre)

// Örnek Parsel (Burhaniye Şarköy civarı temsili dikdörtgene yakın çokgen)
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

// GeoJSON Dosya Yükleme
document.getElementById('geojsonInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            loadParcelData(data);
        } catch (err) {
            alert("Geçersiz GeoJSON dosyası!");
        }
    };
    reader.readAsText(file);
});

// Örnek Parsel Yükleme
document.getElementById('loadSampleBtn').addEventListener('click', () => {
    loadParcelData(sampleGeoJSON);
});

function loadParcelData(geojson) {
    const feature = geojson.type === 'FeatureCollection' ? geojson.features[0] : geojson;
    currentPolygon = feature;
    setbackPolygon = null;

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
        const lengthMeters = turf.distance(p1, p2, { units: 'kilometers' }) * 1000;
        edgesData.push({
            index: i,
            start: coords[i],
            end: coords[i + 1],
            length: lengthMeters,
            type: i === 0 ? 'yol' : 'komsu', // İlk kenarı varsayılan yol yap
            setback: i === 0 ? 5 : 3 // Yol 5m, komşu 3m varsayılan
        });
    }

    renderEdgesUI();
    updateImarSummary();
    document.getElementById('calculateBtn').disabled = false;
    document.getElementById('statusText').innerText = "Parsel yüklendi. Cephe çekme mesafelerini kontrol edin.";
    drawScene();
}

function renderEdgesUI() {
    const container = document.getElementById('edgesList');
    container.innerHTML = '';

    edgesData.forEach((edge, idx) => {
        const div = document.createElement('div');
        div.className = 'edge-item';
        div.innerHTML = `
            <span><strong>K${idx + 1}-K${idx + 2}</strong><br><small>${edge.length.toFixed(1)}m</small></span>
            <select onchange="updateEdgeType(${idx}, this.value)">
                <option value="yol" ${edge.type === 'yol' ? 'selected' : ''}>Yol Cephesi</option>
                <option value="komsu" ${edge.type === 'komsu' ? 'selected' : ''}>Komşu Parsel</option>
                <option value="bitisik" ${edge.type === 'bitisik' ? 'selected' : ''}>Bitişik Nizam (0m)</option>
            </select>
            <input type="number" step="0.5" min="0" value="${edge.setback}" onchange="updateEdgeSetback(${idx}, this.value)">
        `;
        container.appendChild(div);
    });
}

window.updateEdgeType = (idx, val) => {
    edgesData[idx].type = val;
    if (val === 'yol') edgesData[idx].setback = 5;
    if (val === 'komsu') edgesData[idx].setback = 3;
    if (val === 'bitisik') edgesData[idx].setback = 0;
    renderEdgesUI();
    drawScene();
};

window.updateEdgeSetback = (idx, val) => {
    edgesData[idx].setback = parseFloat(val) || 0;
};

function updateImarSummary() {
    if (!currentPolygon) return;
    const area = turf.area(currentPolygon);
    const taks = parseFloat(document.getElementById('taksInput').value) || 0;
    const maxTaban = area * taks;
    document.getElementById('imarOzet').innerHTML = 
        `Parsel Alanı: <strong>${area.toFixed(2)} m²</strong> | Max Taban: <strong>${maxTaban.toFixed(2)} m²</strong>`;
}

['taksInput', 'kaksInput', 'katInput'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateImarSummary);
});

// Çekme Mesafelerine Göre İç Poligon Hesaplama (Kenar Öteleme Algoritması)
document.getElementById('calculateBtn').addEventListener('click', () => {
    if (!currentPolygon) return;

    try {
        // Kenar bazlı çekme için yerel düzlemde (metre) ofset kesişim hesabı
        const coords = currentPolygon.geometry.coordinates[0];
        const center = turf.center(currentPolygon).geometry.coordinates;
        const metersPerDegLat = 111320;
        const metersPerDegLon = 111320 * Math.cos(center[1] * Math.PI / 180);

        // Poligon saat yönünde mi tersi mi kontrol et (Signed Area)
        let areaSum = 0;
        const localPts = coords.slice(0, -1).map(c => ({
            x: (c[0] - center[0]) * metersPerDegLon,
            y: (c[1] - center[1]) * metersPerDegLat
        }));

        for (let i = 0; i < localPts.length; i++) {
            const j = (i + 1) % localPts.length;
            areaSum += (localPts[j].x - localPts[i].x) * (localPts[j].y + localPts[i].y);
        }
        const isClockwise = areaSum > 0;

        // Her kenarı kendi çekme mesafesi kadar içeri ötele (Doğru denklemleri)
        const offsetLines = [];
        for (let i = 0; i < localPts.length; i++) {
            const p1 = localPts[i];
            const p2 = localPts[(i + 1) % localPts.length];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);

            // İçeri bakan birim normal vektör
            let nx = isClockwise ? dy / len : -dy / len;
            let ny = isClockwise ? -dx / len : dx / len;

            const d = edgesData[i].setback;
            offsetLines.push({
                x1: p1.x + nx * d,
                y1: p1.y + ny * d,
                x2: p2.x + nx * d,
                y2: p2.y + ny * d
            });
        }

        // Ardışık ötelenmiş doğruların kesişim noktalarını bul
        const newLocalPts = [];
        for (let i = 0; i < offsetLines.length; i++) {
            const l1 = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
            const l2 = offsetLines[i];
            const pt = intersectLines(l1, l2);
            if (pt) newLocalPts.push(pt);
        }

        // Tekrar Coğrafi Koordinata (Lon/Lat) çevir
        const newGeoCoords = newLocalPts.map(p => [
            center[0] + p.x / metersPerDegLon,
            center[1] + p.y / metersPerDegLat
        ]);
        newGeoCoords.push(newGeoCoords[0]); // Poligonu kapat

        setbackPolygon = turf.polygon([newGeoCoords]);
        updateResultsTable(newGeoCoords);
        drawScene();
        document.getElementById('statusText').innerText = "Çekme sınırı ve köşe koordinatları hesaplandı.";
    } catch (e) {
        alert("Çekme mesafeleri parsel boyutundan büyük olduğu için alan oluşmadı!");
    }
});

function intersectLines(l1, l2) {
    const denom = (l1.x1 - l1.x2) * (l2.y1 - l2.y2) - (l1.y1 - l1.y2) * (l2.x1 - l2.x2);
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((l1.x1 - l2.x1) * (l2.y1 - l2.y2) - (l1.y1 - l2.y1) * (l2.x1 - l2.x2)) / denom;
    return {
        x: l1.x1 + t * (l1.x2 - l1.x1),
        y: l1.y1 + t * (l1.y2 - l1.y1)
    };
}

function updateResultsTable(coords) {
    const tbody = document.querySelector('#coordsTable tbody');
    tbody.innerHTML = '';
    for (let i = 0; i < coords.length - 1; i++) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>B${i + 1}</strong></td>
            <td>${coords[i][0].toFixed(6)}</td>
            <td>${coords[i][1].toFixed(6)}</td>
        `;
        tbody.appendChild(tr);
    }

    const netArea = turf.area(setbackPolygon);
    const kat = parseInt(document.getElementById('katInput').value) || 1;
    document.getElementById('netOturumAlan').innerText = `${netArea.toFixed(2)} m²`;
    document.getElementById('toplamInsaatAlan').innerText = `${(netArea * kat).toFixed(2)} m²`;
    document.getElementById('exportJsonBtn').disabled = false;
}

// 2D Üstten Görünüm Çizim Fonksiyonu
function drawScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!currentPolygon) return;

    const bbox = turf.bbox(currentPolygon);
    const padding = 90;
    const availW = canvas.width - padding * 2;
    const availH = canvas.height - padding * 2;

    const scaleX = availW / (bbox[2] - bbox[0]);
    const scaleY = availH / (bbox[3] - bbox[1]);
    // Enlem/Boylam en-boy oranını koru
    const latFactor = Math.cos(((bbox[1] + bbox[3]) / 2) * Math.PI / 180);
    const scale = Math.min(scaleX / latFactor, scaleY);

    const centerGeo = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

    function toScreen(coord) {
        return {
            x: canvas.width / 2 + (coord[0] - centerGeo[0]) * latFactor * scale,
            y: canvas.height / 2 - (coord[1] - centerGeo[1]) * scale
        };
    }

    // 1. Parsel Kenarlarını Yol / Komşu Rengine Göre Çiz
    edgesData.forEach((edge, i) => {
        const p1 = toScreen(edge.start);
        const p2 = toScreen(edge.end);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = edge.type === 'yol' ? 5 : 3;
        ctx.strokeStyle = edge.type === 'yol' ? '#3b82f6' : (edge.type === 'komsu' ? '#f59e0b' : '#ffffff');
        ctx.stroke();

        // Kenar Etiketi (Yol / Komşu ve Uzunluk)
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "11px sans-serif";
        const label = `${edge.type === 'yol' ? 'YOL' : 'KOMŞU'} (${edge.length.toFixed(1)}m)`;
        ctx.fillText(label, midX - 25, midY - 6);

        // Parsel Köşe Noktası
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`K${i + 1}`, p1.x + 6, p1.y - 6);
    });

    // 2. Çekme Sonrası Bina Oturum Poligonunu Çiz
    if (setbackPolygon) {
        const bCoords = setbackPolygon.geometry.coordinates[0];
        ctx.beginPath();
        bCoords.forEach((c, idx) => {
            const pt = toScreen(c);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.fillStyle = "rgba(16, 185, 129, 0.25)";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#10b981";
        ctx.stroke();
        ctx.setLineDash([]);

        // Bina Köşe Noktalarını İşaretle (B1, B2...)
        for (let i = 0; i < bCoords.length - 1; i++) {
            const pt = toScreen(bCoords[i]);
            ctx.fillStyle = "#10b981";
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(`B${i + 1}`, pt.x + 6, pt.y + 12);
        }
    }
}

// JSON Dışa Aktarma
document.getElementById('exportJsonBtn').addEventListener('click', () => {
    if (!setbackPolygon) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(setbackPolygon, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", "cekme_sonrasi_bina_oturumu.geojson");
    dlAnchor.click();
});
