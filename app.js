// Configuration
const GRID_ROWS = 10;
const GRID_COLS = 5;
// Bounding box for Germany
const BBOX = {
    minLat: 47.0, // South (Bavaria)
    maxLat: 55.2, // North (Sylt/Flensburg)
    minLon: 5.5,  // West (Aachen/Saarland)
    maxLon: 15.2  // East (Görlitz)
};


let map;
let gridData = []; // Stores weather data per cell
let gridLayers = []; // Stores Leaflet polygon layers

// DOM Elements
const tempSlider = document.getElementById('temp-slider');
const precipSlider = document.getElementById('precip-slider');
const windSlider = document.getElementById('wind-slider');
const tempVal = document.getElementById('temp-val');
const precipVal = document.getElementById('precip-val');
const windVal = document.getElementById('wind-val');
const droneSelect = document.getElementById('drone-select');

// Drone Specs
const DRONE_SPECS = {
    'X25': { temp: 40, precip: 10, wind: 15 },
    'V25': { temp: 35, precip: 0.5, wind: 10 },
    'PW.Orca': { temp: 40, precip: 4, wind: 12.5 }
};

// Initialize Map
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([51.1657, 10.4515], 6);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Fit map precisely to the German bounding box
    map.fitBounds([
        [BBOX.minLat, BBOX.minLon],
        [BBOX.maxLat, BBOX.maxLon]
    ]);
}

// Generate Grid and Fetch Data
async function generateWeatherGrid() {
    try {
        const response = await fetch('weather_cache.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const cacheData = await response.json();

        gridData = [];

        // The cache format is map[year][cell_id] = {id, lat, lon, bounds, daily, hourly}
        // We need to merge years for each cell
        const cellsMap = new Map();
        let totalYearsCount = 0;

        for (const [year, cellObjects] of Object.entries(cacheData)) {
            totalYearsCount++;
            for (const [cellId, cellData] of Object.entries(cellObjects)) {
                if (!cellsMap.has(cellId)) {
                    // Initialize with the first year's core structure and deep copy arrays to append to
                    cellsMap.set(cellId, {
                        id: cellId,
                        lat: cellData.lat,
                        lon: cellData.lon,
                        bounds: cellData.bounds,
                        daily: {
                            time: [...(cellData.daily.time || [])],
                            temperature_2m_max: [...(cellData.daily.temperature_2m_max || [])],
                            precipitation_sum: [...(cellData.daily.precipitation_sum || [])],
                            wind_speed_10m_max: [...(cellData.daily.wind_speed_10m_max || [])]
                        },
                        hourly: {
                            time: [...(cellData.hourly.time || [])],
                            temperature_2m: [...(cellData.hourly.temperature_2m || [])],
                            precipitation: [...(cellData.hourly.precipitation || [])],
                            wind_speed_10m: [...(cellData.hourly.wind_speed_10m || [])]
                        }
                    });
                } else {
                    // Append subsequent years
                    const existing = cellsMap.get(cellId);

                    if (cellData.daily) {
                        existing.daily.time.push(...(cellData.daily.time || []));
                        existing.daily.temperature_2m_max.push(...(cellData.daily.temperature_2m_max || []));
                        existing.daily.precipitation_sum.push(...(cellData.daily.precipitation_sum || []));
                        existing.daily.wind_speed_10m_max.push(...(cellData.daily.wind_speed_10m_max || []));
                    }
                    if (cellData.hourly) {
                        existing.hourly.time?.push(...(cellData.hourly.time || []));
                        existing.hourly.temperature_2m.push(...(cellData.hourly.temperature_2m || []));
                        existing.hourly.precipitation.push(...(cellData.hourly.precipitation || []));
                        existing.hourly.wind_speed_10m.push(...(cellData.hourly.wind_speed_10m || []));
                    }
                }
            }
        }

        gridData = Array.from(cellsMap.values());

        // We will store the exact number of years fetched to use for annual averaging logic down the line.
        // Assuming every cell has roughly the same amount of data (3 years worth). 
        // A more robust variable is to calculate (totalDays / 365.25) per cell, which we will do in updateVisualization

        updateVisualization();

    } catch (error) {
        console.error("Failed to load weather data:", error);
        alert("Failed to load weather_cache.json. Ensure you are running via a local server (e.g., python -m http.server 8000).");
    }
}

// old fetchWeatherData removed because it is integrated into generatedWeatherGrid batch process

// Update Visualization based on thresholds
function updateVisualization() {
    const tThr = parseFloat(tempSlider.value);
    const pThr = parseFloat(precipSlider.value);
    const wThr = parseFloat(windSlider.value);

    // Clear existing layers
    gridLayers.forEach(layer => map.removeLayer(layer));
    gridLayers = [];

    gridData.forEach(cell => {
        if (!cell.daily || !cell.hourly) return;

        let totalExceedanceCount = 0;
        const totalDays = cell.daily.time.length;

        // Calculate total years of data for averaging
        const years = totalDays / 365.25;

        // Statistics tracking
        let tempExceedanceDays = 0;
        let precipExceedanceDays = 0;
        let windExceedanceDays = 0;

        let sumPeakTemp = 0;
        let sumPeakPrecip = 0;
        let sumPeakWind = 0;

        let totalHourlyTempExceeds = 0;
        let totalHourlyPrecipExceeds = 0;
        let totalHourlyWindExceeds = 0;

        for (let day = 0; day < totalDays; day++) {
            const tPeak = cell.daily.temperature_2m_max[day];
            const pPeak = cell.daily.precipitation_sum[day];
            const wPeak = cell.daily.wind_speed_10m_max[day];

            let dayExceeded = false;

            if (tPeak > tThr) {
                dayExceeded = true;
                tempExceedanceDays++;
                sumPeakTemp += tPeak;
                // Count hourly breaches for this day
                for (let h = 0; h < 24; h++) {
                    if (cell.hourly.temperature_2m[day * 24 + h] > tThr) totalHourlyTempExceeds++;
                }
            }

            if (pPeak > pThr) {
                dayExceeded = true;
                precipExceedanceDays++;
                sumPeakPrecip += pPeak;
                for (let h = 0; h < 24; h++) {
                    // Hourly precipitation is sum over the hour, daily is total sum.
                    // Technically, comparing daily threshold to hourly doesn't make pure sense unless requested,
                    // but we will count hours where ANY precipitation occurred if daily is exceeded.
                    if (cell.hourly.precipitation[day * 24 + h] > 0) totalHourlyPrecipExceeds++;
                }
            }

            if (wPeak > wThr) {
                dayExceeded = true;
                windExceedanceDays++;
                sumPeakWind += wPeak;
                for (let h = 0; h < 24; h++) {
                    if (cell.hourly.wind_speed_10m[day * 24 + h] > wThr) totalHourlyWindExceeds++;
                }
            }

            if (dayExceeded) totalExceedanceCount++;
        }

        // Annualized averages
        const avgExceedanceDaysYr = totalExceedanceCount / years;
        const avgTempExceedanceDaysYr = tempExceedanceDays / years;
        const avgPrecipExceedanceDaysYr = precipExceedanceDays / years;
        const avgWindExceedanceDaysYr = windExceedanceDays / years;

        const ratio = totalExceedanceCount / totalDays;

        // Color based on specific exceedance day thresholds (annualized)
        let color, opacity;

        if (avgExceedanceDaysYr === 0) {
            color = 'transparent';
            opacity = 0;
        } else if (avgExceedanceDaysYr <= 30) {
            color = '#4ade80'; // Slight Green
            opacity = 0.3 + (avgExceedanceDaysYr / 30) * 0.3;
        } else if (avgExceedanceDaysYr <= 70) {
            color = '#facc15'; // Yellow
            opacity = 0.5 + ((avgExceedanceDaysYr - 30) / 40) * 0.3;
        } else if (avgExceedanceDaysYr < 200) {
            color = '#fb923c'; // Orange
            opacity = 0.6 + ((avgExceedanceDaysYr - 70) / 130) * 0.3;
        } else {
            color = '#ef4444'; // Red (200+)
            opacity = 0.9;
        }

        const polygon = L.rectangle(cell.bounds, {
            color: 'transparent',
            fillColor: color,
            fillOpacity: opacity,
            weight: 1
        }).addTo(map);

        // Averages calculation (Overall, not annualized)
        const avgTempPeak = tempExceedanceDays ? (sumPeakTemp / tempExceedanceDays).toFixed(1) : '-';
        const avgTempHours = tempExceedanceDays ? (totalHourlyTempExceeds / tempExceedanceDays).toFixed(1) : '-';

        const avgPrecipPeak = precipExceedanceDays ? (sumPeakPrecip / precipExceedanceDays).toFixed(1) : '-';
        const avgPrecipHours = precipExceedanceDays ? (totalHourlyPrecipExceeds / precipExceedanceDays).toFixed(1) : '-';

        const avgWindPeak = windExceedanceDays ? (sumPeakWind / windExceedanceDays).toFixed(1) : '-';
        const avgWindHours = windExceedanceDays ? (totalHourlyWindExceeds / windExceedanceDays).toFixed(1) : '-';

        polygon.bindTooltip(`
            <div style="font-family: 'Outfit'; color: black; min-width: 200px;">
                <strong style="font-size: 1.1em; border-bottom: 1px solid rgba(0,0,0,0.2); padding-bottom: 4px; display: block; margin-bottom: 6px;">
                    Region Analysis (Avg over ${years.toFixed(1)} yrs)
                </strong>
                <div>Avg Exceedance: <strong>${avgExceedanceDaysYr.toFixed(1)} days/yr</strong> (${(ratio * 100).toFixed(1)}%)</div>

                <div style="margin-top: 10px; font-size: 0.9em; color: rgba(0,0,0,0.8);">
                    <div style="padding: 4px 0;">
                        <span style="color: #cc0000; font-weight: 600;">Temp Exceedance</span>: ${avgTempExceedanceDaysYr.toFixed(1)} days/yr<br>
                        ↳ Avg Peak: ${avgTempPeak}°C<br>
                        ↳ Avg Duration: ${avgTempHours} hrs/day
                    </div>
                    <div style="padding: 4px 0;">
                        <span style="color: #0066cc; font-weight: 600;">Precip Exceedance</span>: ${avgPrecipExceedanceDaysYr.toFixed(1)} days/yr<br>
                        ↳ Avg Total: ${avgPrecipPeak} L/m²<br>
                        ↳ Avg Rain Duration: ${avgPrecipHours} hrs/day
                    </div>
                    <div style="padding: 4px 0;">
                        <span style="color: #b3b300; font-weight: 600;">Wind Exceedance</span>: ${avgWindExceedanceDaysYr.toFixed(1)} days/yr<br>
                        ↳ Avg Peak: ${avgWindPeak} m/s<br>
                        ↳ Avg Duration: ${avgWindHours} hrs/day
                    </div>
                </div>
            </div>
        `, { sticky: true });

        gridLayers.push(polygon);
    });
}

// Event Listeners
tempSlider.addEventListener('input', () => {
    tempVal.textContent = tempSlider.value;
    droneSelect.value = 'custom';
    updateVisualization();
});
precipSlider.addEventListener('input', () => {
    precipVal.textContent = precipSlider.value;
    droneSelect.value = 'custom';
    updateVisualization();
});
windSlider.addEventListener('input', () => {
    windVal.textContent = windSlider.value;
    droneSelect.value = 'custom';
    updateVisualization();
});

// Dropdown change listener
droneSelect.addEventListener('change', () => {
    const drone = droneSelect.value;
    if (drone === 'custom') return;

    const specs = DRONE_SPECS[drone];
    tempSlider.value = specs.temp;
    precipSlider.value = specs.precip;
    windSlider.value = specs.wind;

    tempVal.textContent = specs.temp;
    precipVal.textContent = specs.precip;
    windVal.textContent = specs.wind;

    updateVisualization();
});

// Initialization
initMap();
generateWeatherGrid();
