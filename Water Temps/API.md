# WaterTemp API

All endpoints are relative to the server root (e.g. `https://yourserver.com/api/...`).  
All request and response bodies are `application/json`.  
All temperatures are stored and transmitted in **Celsius**. The frontend handles conversion.  
Dates are **YYYY-MM-DD** strings. Datetimes are **YYYY-MM-DDTHH:MM** (local time, no timezone suffix) for citizen submissions.

---

## Endpoints

### `GET /api/readings`

Returns an array of temperature readings, optionally filtered. Used on map load and whenever the sidebar filters change.

#### Query parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `types` | string | all types | Comma-separated list of water types to include. Valid values: `lake`, `river`, `ocean`, `pond`, `stream`, `other` |
| `source` | string | `all` | Filter by source. Values: `all`, `citizen`, `public` |
| `dateFrom` | string | — | ISO date `YYYY-MM-DD`. Only return readings on or after this date. |
| `dateTo` | string | — | ISO date `YYYY-MM-DD`. Only return readings on or before this date. |
| `tempMin` | number | — | Minimum temperature in °C (inclusive). |
| `tempMax` | number | — | Maximum temperature in °C (inclusive). |
| `nearLat` | number | — | Latitude of centre point for proximity search. Requires `nearLng` and `nearRadius`. |
| `nearLng` | number | — | Longitude of centre point for proximity search. |
| `nearRadius` | number | — | Radius in kilometres for proximity search. |

#### Example request

```
GET /api/readings?types=lake,river&source=citizen&tempMin=10&tempMax=25&nearLat=47.6&nearLng=-122.3&nearRadius=200
```

#### Response `200 OK`

Array of reading objects. Each object represents one monitoring location and includes its full temperature history.

```json
[
  {
    "id": "usgs-12134500",
    "waterBody": "Snoqualmie River",
    "type": "river",
    "lat": 47.5276,
    "lng": -121.7843,
    "tempC": 14.2,
    "date": "2026-06-14",
    "source": "public",
    "sourceDetail": "USGS",
    "email": null,
    "notes": null,
    "photoUrl": null,
    "history": [
      { "date": "2025-06-15", "tempC": 13.1 },
      { "date": "2025-06-22", "tempC": 14.8 }
    ]
  },
  {
    "id": "citizen-1750000000000",
    "waterBody": null,
    "type": "lake",
    "lat": 47.6301,
    "lng": -122.2574,
    "tempC": 18.5,
    "date": "2026-06-13T09:30",
    "source": "citizen",
    "sourceDetail": null,
    "email": "j***@gmail.com",
    "notes": "Measured from the dock at Madrona Park.",
    "photoUrl": "https://yourserver.com/photos/abc123.jpg",
    "history": []
  }
]
```

#### Reading object fields

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string | no | Unique ID. Public data uses `usgs-{siteNo}` or `noaa-{stationId}`. Citizen submissions use `citizen-{timestamp}`. |
| `waterBody` | string | yes | Name of the water body. `null` for citizen submissions (not collected). |
| `type` | string | no | One of: `lake`, `river`, `ocean`, `pond`, `stream`, `other` |
| `lat` | number | no | Latitude in decimal degrees (WGS84). |
| `lng` | number | no | Longitude in decimal degrees (WGS84). |
| `tempC` | number | no | Temperature in Celsius, rounded to 1 decimal place. |
| `date` | string | no | Date of the most recent reading. `YYYY-MM-DD` for public data; `YYYY-MM-DDTHH:MM` for citizen submissions. |
| `source` | string | no | `"public"` (automated monitoring station) or `"citizen"` (user submission). |
| `sourceDetail` | string | yes | Agency name for public sources (e.g. `"USGS"`, `"NOAA"`). `null` for citizen submissions. |
| `email` | string | yes | Masked email for citizen submissions (e.g. `"j***@gmail.com"`). `null` for public data. |
| `notes` | string | yes | Free-text notes from the submitter. |
| `photoUrl` | string | yes | URL of the uploaded thermometer photo. `null` if no photo was submitted. |
| `history` | array | no | Chronological array of past readings for this location (see below). Empty array `[]` for first-time citizen submissions. |

#### History entry fields

| Field | Type | Description |
|---|---|---|
| `date` | string | `YYYY-MM-DD` |
| `tempC` | number | Temperature in Celsius, 1 decimal place. |

History entries for public monitoring stations are **weekly-averaged** when more than 52 entries exist, keeping the oldest date in each 7-day bucket. Entries are sorted ascending by date.

---

### `POST /api/readings`

Submits a new citizen science temperature reading. Used when a user completes and submits the Log form.

#### Request body

```json
{
  "waterBody": null,
  "type": "lake",
  "lat": 47.6301,
  "lng": -122.2574,
  "tempC": 18.5,
  "date": "2026-06-15T09:30",
  "source": "citizen",
  "email": "j***@gmail.com",
  "notes": "Measured from the dock at Madrona Park.",
  "photoUrl": null
}
```

#### Request body fields

| Field | Type | Required | Description |
|---|---|---|---|
| `waterBody` | string | no | Always `null` from the frontend (name field was removed from the form). |
| `type` | string | yes | One of: `lake`, `river`, `ocean`, `pond`, `stream`, `other` |
| `lat` | number | yes | Latitude from the map location picker or photo EXIF. |
| `lng` | number | yes | Longitude from the map location picker or photo EXIF. |
| `tempC` | number | yes | Temperature in Celsius. Frontend converts from °F if needed before sending. |
| `date` | string | yes | `YYYY-MM-DDTHH:MM` local time, from the form's datetime-local field or photo EXIF. |
| `source` | string | yes | Always `"citizen"` from this endpoint. |
| `email` | string | yes | Masked email (e.g. `"j***@gmail.com"`). The full address is held client-side in localStorage for form pre-fill only and is not transmitted. |
| `notes` | string | no | Optional free text. |
| `photoUrl` | string | no | URL of a previously uploaded photo, or `null`. If a photo was chosen, the client will have base64-encoded it; the backend should accept the image and return a hosted URL to store here. |

#### Response `201 Created`

The saved reading object as it was stored, including the server-assigned `id` and an empty `history` array.

```json
{
  "id": "citizen-1750000000000",
  "waterBody": null,
  "type": "lake",
  "lat": 47.6301,
  "lng": -122.2574,
  "tempC": 18.5,
  "date": "2026-06-15T09:30",
  "source": "citizen",
  "sourceDetail": null,
  "email": "j***@gmail.com",
  "notes": "Measured from the dock at Madrona Park.",
  "photoUrl": null,
  "history": []
}
```

---

## Error responses

All endpoints return a consistent error shape on failure.

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

| HTTP status | When |
|---|---|
| `400 Bad Request` | Missing required field or invalid value (e.g. `tempC` out of −10–50 range, unknown `type`). |
| `422 Unprocessable Entity` | Request parsed but logically invalid (e.g. `dateFrom` is after `dateTo`). |
| `500 Internal Server Error` | Unexpected server error. |

---

## Public data import (cron)

These are not called by the frontend. They are internal backend jobs that populate the `readings` table from external sources on a scheduled cadence.

| Source | Endpoint | Schedule | Notes |
|---|---|---|---|
| USGS NWIS | `https://waterservices.usgs.gov/nwis/dv/?parameterCd=00010` | Daily | Parameter `00010` = water temp °C. Filter out `-999999` and `"Ice"` values. |
| NOAA CO-OPS | `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_temperature` | Daily | Hourly data aggregated to daily averages. Max 365-day window per request. |
| WA Dept of Ecology | EIM database export | Weekly | Form-based portal — requires scraper or manual export until an API is negotiated. |
| King County buoys | `https://green2.kingcounty.gov/lake-buoy/` | Daily | Monitors Lake Washington and Lake Sammamish — form-based portal, same caveat as Ecology. |
