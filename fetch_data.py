
import requests
import json
import time
import os
import sys

# ---------------------------------------------------------
# Configuration: Germany Bounding Box & Grid Settings

GRID_ROWS = 10
GRID_COLS = 5
BBOX = {
    'minLat': 47.0,
    'maxLat': 55.2,
    'minLon': 5.5,
    'maxLon': 15.2
}

# Fetching only 2023 at first to ensure the dataset works properly.
# Once verified, you can add [2022, 2021, 2020, 2019] back to this list.
YEARS_TO_FETCH = [2024,2023,2022]

CACHE_FILE = "weather_cache.json"

# Open-Meteo Free API Rate Limit configurations
BATCH_SIZE = 10  
SLEEP_BETWEEN_BATCHES_SECONDS = 5  

api_calls_made = 0


# ---------------------------------------------------------

def generate_grid_cells():
    """Calculates the center points for all 50 Germany grid segments."""
    lat_step = (BBOX['maxLat'] - BBOX['minLat']) / GRID_ROWS
    lon_step = (BBOX['maxLon'] - BBOX['minLon']) / GRID_COLS
    
    cells = []
    
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            lat_min = BBOX['minLat'] + r * lat_step
            lat_max = lat_min + lat_step
            lon_min = BBOX['minLon'] + c * lon_step
            lon_max = lon_min + lon_step
            
            center_lat = lat_min + lat_step / 2
            center_lon = lon_min + lon_step / 2
            
            cells.append({
                "id": f"cell-{r}-{c}",
                "r": r,
                "c": c,
                "lat": round(center_lat, 4),
                "lon": round(center_lon, 4),
                "bounds": [[lat_min, lon_min], [lat_max, lon_max]]
            })
            
    return cells

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Failed to load cache: {e}")
            return {}
    return {}

def save_cache(cache):
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f)

def fetch_and_cache_data():
    global api_calls_made
    cells = generate_grid_cells()
    total_cells = len(cells)
    
    print(f"Starting progressive fetch for {total_cells} locations, years: {YEARS_TO_FETCH}.")
    
    cache = load_cache()

    for year in YEARS_TO_FETCH:
        year_str = str(year)
        if year_str not in cache:
            cache[year_str] = {}
            
        print(f"\n=== Fetching data for year {year} ===")
        start_date = f"{year}-01-01"
        end_date = f"{year}-12-31"

        # Process in batches
        for i in range(0, total_cells, BATCH_SIZE):
            batch = cells[i:i + BATCH_SIZE]
            
            # Identify which cells actually need fetching for this year
            missing_batch = [cell for cell in batch if cell['id'] not in cache[year_str]]
            
            if not missing_batch:
                print(f"   Skipping batch {(i//BATCH_SIZE)+1}/{(total_cells//BATCH_SIZE)} - already fetched.")
                continue
            
            lats = ",".join(str(cell['lat']) for cell in missing_batch)
            lons = ",".join(str(cell['lon']) for cell in missing_batch)
            
            url = (
                f"https://archive-api.open-meteo.com/v1/archive?"
                f"latitude={lats}&longitude={lons}&"
                f"start_date={start_date}&end_date={end_date}&"
                f"hourly=temperature_2m,precipitation,wind_speed_10m&"
                f"daily=temperature_2m_max,precipitation_sum,wind_speed_10m_max&"
                f"timezone=GMT&wind_speed_unit=ms"
            )
            
            print(f"   Fetching batch {(i//BATCH_SIZE)+1}/{(total_cells//BATCH_SIZE)} (Fetching {len(missing_batch)} missing cells)...")
            
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    response = requests.get(url, timeout=30)
                    api_calls_made += 1
                    
                    if response.status_code == 429:
                        print(f"   [!] Rate limit hit (429).")
                        print(f"\n[Session Complete] Total API calls made this run: {api_calls_made}")
                        sys.exit(1)
                        
                    response.raise_for_status()
                    data_list = response.json()
                    
                    if not isinstance(data_list, list):
                        data_list = [data_list]
                        
                    for idx, api_data in enumerate(data_list):
                        if "error" in api_data:
                            print(f"   [Error in data]: {api_data.get('reason', 'Unknown API Error')}")
                            continue
                            
                        cell_ref = missing_batch[idx]
                        
                        cache[year_str][cell_ref["id"]] = {
                            "id": cell_ref["id"],
                            "lat": cell_ref["lat"],
                            "lon": cell_ref["lon"],
                            "bounds": cell_ref["bounds"],
                            "daily": api_data.get("daily", {}),
                            "hourly": api_data.get("hourly", {})
                        }
                    
                    # Successfully fetched, save progress immediately
                    save_cache(cache)
                    break 

                except requests.exceptions.RequestException as e:
                    print(f"   [!] Request failed: {e}. Retrying in 10s...")
                    time.sleep(10)
            else:
                print(f"   [FAILED] Could not fetch batch {(i//BATCH_SIZE)+1} after {max_retries} attempts.")

            # Respect API Limits between requests
            print(f"   Sleeping {SLEEP_BETWEEN_BATCHES_SECONDS}s before next batch...")
            time.sleep(SLEEP_BETWEEN_BATCHES_SECONDS)

    print(f"\nDone fetching all specified years!")
    print(f"[Session Complete] Total API calls made this run: {api_calls_made}")

if __name__ == "__main__":
    fetch_and_cache_data()
