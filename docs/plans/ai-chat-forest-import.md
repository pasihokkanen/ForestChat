# AI Chat-Based Forest Import

**Status:** Draft — Architecture Plan  
**Date:** 2026-06-21  
**Author:** Systems Architect (via Hermes Agent)  
**Owner:** Pasi Hokkanen  
**Repo:** github.com/pasihokkanen/ForestChat  
**Depends on:** Global chat panel (multi-forest-global-chat.md §B), existing csv-parser.ts + csv-importer.ts

---

## 1. Overview

Currently, forest import happens through a dedicated `/forest/new` page with a form (property ID + CSV file upload). This plan adds a second path: import through the AI chat panel. The user uploads a CSV file (or provides forest data in another tabular format) directly in the chat, the AI inspects it, detects the format, converts if needed, asks for missing information, and imports the forest.

### User Experience

```
User: [uploads kuviotiedot_2026.csv]

AI:  I found a Finnish kuviotiedot CSV: 142 compartments, 32,536 m³ total volume.
     Main species: spruce (51%), pine (35%), birch (12%).
     What property ID should I use for this forest? (e.g., 989-405-0001-0405)

User: 989-405-0001-0405

AI:  And what name should I give this forest? (I suggest "Hokkala 2026" based on the filename)

User: Hokkala 2026

AI:  Importing... ✅ Forest "Hokkala 2026" imported!
     142 compartments · 250.2 ha · 32,536 m³ · Ähtäri (gm: 1.08)
     Open forest → /forest/c7b3a891-...
```

### Design Goals

1. **Preview before import** — AI shows what it found before writing to DB
2. **Ask for missing info** — property ID and forest name are required; AI must not guess
3. **Handle non-standard formats** — CSV with different columns, delimiters, or structure
4. **Reuse existing pipeline** — `csv-parser.ts` for standard format, `csv-importer.ts` for DB writes
5. **Graceful errors** — clear messages when parsing fails, with suggested fixes

---

## 2. Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ ChatInput    │────▶│ /api/chat/upload │────▶│ /tmp/chat-uploads/  │
│ (paperclip)  │     │ (multipart POST) │     │ <userId>/<file>.csv │
└──────────────┘     └──────────────────┘     └─────────┬───────────┘
                                                        │ file_path
                                                        ▼
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ AI Chat      │────▶│ Tool: preview_   │────▶│ csv-parser.ts        │
│ (SSE loop)   │     │ csv_file         │     │ (format detection,   │
│              │◀────│                  │◀────│  column mapping,     │
│              │     │                  │     │  stand count/volume) │
│              │     └──────────────────┘     └─────────────────────┘
│              │
│              │     ┌──────────────────┐     ┌─────────────────────┐
│              │────▶│ Tool: convert_   │────▶│ Transform script     │
│              │     │ csv_format       │     │ (column mapping,     │
│              │◀────│                  │◀────│  delimiter change,   │
│              │     │                  │     │  decimal fix)        │
│              │     └──────────────────┘     └─────────────────────┘
│              │
│              │     ┌──────────────────┐     ┌─────────────────────┐
│              │────▶│ Tool: import_    │────▶│ csv-importer.ts      │
│              │     │ forest_csv       │     │ (MML boundary fetch, │
│              │◀────│                  │◀────│  Supabase inserts,   │
│              │     │                  │     │  municipality lookup)│
│              │     └──────────────────┘     └─────────────────────┘
└──────────────┘
```

### Key Principle

The AI only orchestrates — it does NOT parse CSV content inline. All heavy work (parsing, conversion, import) happens in server-side tool handlers. The AI's role is:

1. Guide the conversation (ask for property ID, forest name)
2. Interpret tool results (show preview to user)
3. Decide next action (convert first, or import directly)
4. Handle errors gracefully

---

## 3. File Upload

### 3.1 API Route

**`POST /api/chat/upload`** — New route, authenticated via Supabase session cookie.

```
Content-Type: multipart/form-data

Fields:
  file:   (binary)  — the CSV file

Response 200:
{
  "file_path": "/tmp/chat-uploads/<userId>/2026-06-21T14..._kuviotiedot_2026.csv",
  "filename": "kuviotiedot_2026.csv",
  "size_bytes": 45218,
  "mime_type": "text/csv",
  "row_count": 290,
  "first_rows": "Kuvion numero;Pinta-ala, ha;Maaluokka...\n1;1.5;Metsämaata...\n2;0.8;..."
}
```

**Security:**
- Max file size: 10 MB
- Only `text/csv` and `application/vnd.ms-excel` MIME types accepted
- Files stored in `/tmp/chat-uploads/<userId>/` — scoped per user, cleared on server restart
- File paths never disclosed to other users

### 3.2 Chat UI

The `ChatInput` component gains a paperclip button (📎) that opens the OS file picker. Selected file appears as a thumbnail card above the input:

```
┌─────────────────────────────────────────────┐
│ 📄 kuviotiedot_2026.csv (44 KB)      [✕]   │
│ ─────────────────────────────────────────── │
│ Type your message...                   [→]  │
└─────────────────────────────────────────────┘
```

On send, the file is uploaded first, then the message text + `file_path` metadata is sent through SSE.

### 3.3 SSE Protocol Extension

The SSE `POST /api/chat` body gains an optional `uploaded_file` field:

```json
{
  "message": "Import this forest data",
  "forest_ids": [],
  "language": "en",
  "uploaded_file": {
    "file_path": "/tmp/chat-uploads/.../kuviotiedot_2026.csv",
    "filename": "kuviotiedot_2026.csv"
  }
}
```

The system prompt is extended with: `User uploaded file: kuviotiedot_2026.csv (290 rows, available at /tmp/...)`

---

## 4. AI Tools

### 4.1 `preview_csv_file`

**Purpose:** Inspect an uploaded CSV — detect format, show columns, count stands, estimate volume.

**Parameters:**
```typescript
{
  file_path: string;   // path from upload response
}
```

**Returns:**
```json
{
  "format": "finnish_kuviotiedot",    // or "simple_columns" | "unknown"
  "delimiter": ";",
  "decimal_separator": ",",
  "encoding": "utf-8-sig",
  "stand_count": 142,
  "total_volume_m3": 32536,
  "total_area_ha": 250.2,
  "columns": [
    "Kuvion numero", "Pinta-ala, ha", "Maaluokka",
    "Kehitysluokka", "Kasvupaikka", "Maalaji",
    "Ojitustilanne", "Pääpuulaji", "Total-ikä, v"
  ],
  "main_species_breakdown": {
    "pine": 35,
    "spruce": 51,
    "silver_birch": 8,
    "downy_birch": 4,
    "grey_alder": 2
  },
  "issues": [
    "Column 'Sp.' at position 4 — expected 'Pääpuulaji' or 'main_species'"
  ],
  "parseable": true
}
```

**Format detection logic (server-side):**

```
1. Try parseForestDataCsv() from csv-parser.ts (strict Finnish format)
   → succeeds → format = "finnish_kuviotiedot", parseable = true

2. Try PapaParse with header:true, delimiter detection
   → analyze columns against expected schema
   → map known column names (FI_TO_EN_COLUMN, SPECIES_NAME_MAP)
   → format = "simple_columns", parseable = (coverage >= 60%)

3. Neither works
   → format = "unknown", parseable = false
   → return first 10 rows as sample for AI analysis
```

### 4.2 `convert_csv_format`

**Purpose:** Transform a non-standard CSV into importable kuviotiedot format.

**Parameters:**
```typescript
{
  file_path: string;              // source file
  column_mapping: Record<string, string>;  // e.g., { "Species": "Pääpuulaji", "Area": "Pinta-ala, ha" }
  delimiter?: string;            // override detected delimiter ("," → ";")
  decimal_separator?: string;    // "." → ","
  encoding?: string;             // if not utf-8
  skip_rows?: number;            // skip N header rows
}
```

**Returns:**
```json
{
  "output_path": "/tmp/chat-uploads/<userId>/converted_kuviotiedot.csv",
  "rows_converted": 142,
  "columns_mapped": 15,
  "columns_dropped": 3,
  "warnings": [
    "Column 'Notes' had no mapping — dropped",
    "3 rows had negative volume values — set to 0"
  ]
}
```

**Implementation:** Python script (or Node.js transform) that reads the source CSV, applies `column_mapping`, fixes delimiters/decimals, and writes the expected kuviotiedot format. The output can then be fed to `import_forest_csv` or `preview_csv_file` again.

### 4.3 `import_forest_csv`

**Purpose:** Import a parsed CSV into Supabase as a new forest.

**Parameters:**
```typescript
{
  file_path: string;        // path to the CSV file (original or converted)
  property_id: string;      // Finnish kiinteistötunnus (required)
  name: string;             // forest display name (required)
}
```

**Returns:**
```json
{
  "forest_id": "c7b3a891-d4e5-...",
  "name": "Hokkala 2026",
  "property_id": "989-405-0001-0405",
  "stands_imported": 142,
  "stands_with_geometry": 140,
  "species_rows_imported": 568,
  "total_volume_m3": 32536,
  "total_area_ha": 250.2,
  "municipality": "Ähtäri",
  "growth_multiplier": 1.08,
  "warnings": ["Stand 89: invalid WKT geometry", "Stand 142: zero volume"]
}
```

**Implementation:** Wraps the existing `parseForestDataCsv()` + `importStandsFromCsv()` pipeline. The tool handler:
1. Authenticates user via context
2. Reads file from `file_path`
3. Calls `parseForestDataCsv()`
4. Calls `importStandsFromCsv()` with user's Supabase client and MML API key
5. Returns result + forest_id for navigation

### 4.4 `cancel_import`

**Purpose:** Clean up uploaded files if user abandons the import.

**Parameters:**
```typescript
{
  file_path: string;
}
```

Deletes the file from `/tmp/chat-uploads/`. Called automatically on conversation reset or explicitly by the AI.

---

## 5. System Prompt Guidance

The dashboard-mode system prompt includes import-specific instructions:

```
IMPORT WORKFLOW — when the user provides a CSV file:
1. ALWAYS call preview_csv_file first — never call import_forest_csv without previewing.
2. Show the user what you found: stand count, volume, species breakdown, any format issues.
3. If format issues exist, explain them clearly and offer to convert.
4. If the format is unrecognizable, show the user the first few rows and ask for help mapping columns.
5. REQUIRED before import: property_id (Finnish kiinteistötunnus) and forest name.
   - If the user hasn't provided them, ASK. Do not guess or use defaults.
   - Derive forest name from filename if reasonable (e.g., kuviotiedot_2026.csv → "Hokkala 2026"), but confirm.
6. After successful import, tell the user the forest ID and suggest navigating to it.

FORMAT ISSUES — how to handle them:
- Delimiter mismatch: ", " instead of ";" → call convert_csv_format with delimiter:","
- Decimal separator: "." instead of "," → call convert_csv_format with decimal_separator:"."
- Unknown columns: show the user a mapping table and ask to confirm before converting
- Missing required columns: tell the user which columns are missing and ask them to provide the data
- Mixed formats: explain what's wrong and ask the user to provide a cleaner file

CRITICAL — never call import_forest_csv without:
✓ preview_csv_file has been called and returned parseable:true
✓ property_id has been confirmed by the user
✓ forest name has been confirmed by the user
```

---

## 6. Format Conversion — Detailed Logic

### 6.1 Conversion Matrix

| Issue Detected | AI Response | Tool Call |
|---|---|---|
| Wrong delimiter (`,`) | "This CSV uses commas as delimiters. I'll convert it." | `convert_csv_format(delimiter:",")` |
| Dot decimal (`.`) | "Numbers use dots as decimals (Finnish format uses commas). Converting." | `convert_csv_format(decimal_separator:".")` |
| English column names | "I found English column names. Mapping to Finnish format: Species→Pääpuulaji, etc." | `convert_csv_format(column_mapping={...})` |
| Extra columns | "Columns X, Y, Z don't match any forest data field. They'll be dropped." | `convert_csv_format(column_mapping={...})` → unmapped columns dropped |
| Missing required columns | "This file is missing: Pääpuulaji, Kehitysluokka. Can you provide these?" | No conversion — ask user |
| Not CSV at all | "This doesn't appear to be a CSV file. I can only import CSV forest data." | Error — ask for CSV |

### 6.2 Column Mapping Heuristics

The server-side `preview_csv_file` handler uses these heuristics to auto-detect column mappings:

```typescript
const COLUMN_ALIASES: Record<string, string[]> = {
  "Pääpuulaji": ["species", "sp", "tree_species", "dominant_species", "main_species", "pääpuulaji"],
  "Kehitysluokka": ["development_class", "dev_class", "stage", "kehitysluokka"],
  "Kasvupaikka": ["site_type", "site", "habitat", "kasvupaikka", "kasvupaikkatyyppi"],
  "Pinta-ala, ha": ["area_ha", "area", "pinta-ala", "ala_ha", "hehtaaria"],
  "Kuvion numero": ["stand_id", "kuvio", "kuvion_numero", "compartment", "id"],
  "Total-m3": ["volume_m3", "total_volume", "volume", "total_m3", "tilavuus"],
  "Total-ikä, v": ["age_years", "age", "ika", "total_age", "stand_age"],
  "Maalaji": ["soil_type", "soil", "maalaji", "ground"],
  "Ojitustilanne": ["drainage_status", "drainage", "ojitus", "ojitustilanne"],
};
```

When ≥60% of expected columns are found via aliases, the format is considered "simple_columns" and parseable after mapping. The AI shows the detected mapping and asks for confirmation.

---

## 7. Implementation

### 7.1 New Files

| File | Purpose |
|---|---|
| `src/app/api/chat/upload/route.ts` | File upload endpoint |
| `src/components/chat/FileUploadCard.tsx` | Thumbnail card for uploaded file in chat |
| `src/lib/chat/tools-import.ts` | Tool definitions for import tools (separate from plan tools) |

### 7.2 Modified Files

| File | Change |
|---|---|
| `src/components/chat/ChatInput.tsx` | Add paperclip button, file state, upload-on-send |
| `src/lib/chat/tool-executor.ts` | Add handlers: `preview_csv_file`, `convert_csv_format`, `import_forest_csv`, `cancel_import` |
| `src/lib/chat/system-prompt.ts` | Add import workflow section to dashboard mode |
| `src/lib/chat/sse-client.ts` | Extend SSE request body with `uploaded_file` field |
| `src/app/api/chat/route.ts` | Accept `uploaded_file` in request body; pass to system prompt |

### 7.3 Tool Handler Skeletons

```typescript
// preview_csv_file — in tool-executor.ts
async function handlePreviewCsvFile(
  args: { file_path: string },
  ctx: ToolContext
): Promise<ToolResult> {
  // 1. Validate user owns the file (path contains userId)
  // 2. Read file from disk
  // 3. Try parseForestDataCsv() (strict Finnish format)
  // 4. If fails, try PapaParse with auto-detection
  // 5. Build preview response with format classification
  // 6. Return structured preview
}

// convert_csv_format
async function handleConvertCsvFormat(
  args: {
    file_path: string;
    column_mapping: Record<string, string>;
    delimiter?: string;
    decimal_separator?: string;
    encoding?: string;
    skip_rows?: number;
  },
  ctx: ToolContext
): Promise<ToolResult> {
  // 1. Read source file
  // 2. Apply column mapping (rename columns)
  // 3. Fix delimiter if specified
  // 4. Fix decimal separator if specified (regex: replace \d+\.\d+ with \d+,\d+)
  // 5. Drop unmapped columns
  // 6. Write output to /tmp/chat-uploads/<userId>/converted_<filename>.csv
  // 7. Return output path + stats
}

// import_forest_csv
async function handleImportForestCsv(
  args: { file_path: string; property_id: string; name: string },
  ctx: ToolContext
): Promise<ToolResult> {
  // 1. Read file
  // 2. parseForestDataCsv() — must succeed (caller should have verified)
  // 3. importStandsFromCsv() with ctx.supabase, ctx.userId, env.mmlApiKey
  // 4. Return forest_id + stats
}
```

### 7.4 ChatInput Changes

```tsx
// ChatInput.tsx — additions
const [attachedFile, setAttachedFile] = useState<File | null>(null);
const [uploading, setUploading] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);

async function handleSend(text: string) {
  let uploadedFile: UploadedFileMeta | null = null;

  if (attachedFile) {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", attachedFile);
    const res = await fetch("/api/chat/upload", { method: "POST", body: formData });
    uploadedFile = await res.json();
    setAttachedFile(null);
    setUploading(false);
  }

  // Pass uploadedFile alongside message text to SSE stream
  props.onSend(text, uploadedFile);
}
```

---

## 8. Error Recovery

### 8.1 Parse Failures

| Error Scenario | AI Response |
|---|---|
| CSV parse error (malformed) | "This file couldn't be parsed. It may be corrupted or not a valid CSV. Error: ..." |
| Empty CSV (0 stands) | "This file has no stand data. Check that it's a kuviotiedot CSV." |
| Encoding issues (mojibake) | "The file encoding looks wrong. Try saving as UTF-8." |
| Property ID not found | "Property 989-405-0001-0405 wasn't found in the land registry. Check the ID." |
| MML API down | "The property boundary service is unavailable. The forest was imported but stands won't have map geometry." |

### 8.2 Partial Imports

If `importStandsFromCsv` partially succeeds (some stands imported, some failed), the tool returns warnings alongside the successful count. The AI summarizes: "142 compartments imported. 2 warnings: stand 89 had invalid geometry, stand 142 had zero volume."

### 8.3 User Abandons Import

If the user starts an import conversation then sends `/new` or switches context, the temporary files in `/tmp/chat-uploads/<userId>/` should be cleaned up. The `cancel_import` tool or session reset handles this.

---

## 9. Limitations (MVP)

| Not In Scope | Reason |
|---|---|
| Excel (.xlsx) files | Would require xlsx parser dependency; CSV covers 95% of cases |
| PDF forest reports | Unstructured data extraction too unreliable for MVP |
| Free-text "I have 50 hectares of pine..." | AI hallucination risk; require structured data |
| Multi-file import (boundary GeoJSON + attributes CSV) | Separate import path; not chat-driven |
| Editing imported data before commit | Import is all-or-nothing; user edits via plan tools after import |

---

## 10. Test Scenarios

| # | Scenario | Expected |
|---|---|---|
| 1 | Upload standard `kuviotiedot_2026.csv` | AI shows preview, asks for property ID, imports |
| 2 | Upload CSV with comma delimiter | AI detects wrong delimiter, offers to convert |
| 3 | Upload CSV with English column names | AI shows mapping, asks to confirm, converts |
| 4 | Upload file with missing `Pääpuulaji` column | AI reports missing columns, asks user to fix |
| 5 | Upload non-CSV file (.txt, .xlsx) | AI rejects with clear message |
| 6 | User cancels mid-import ("never mind") | AI calls cancel_import, cleans up temp files |
| 7 | Property ID not found by MML API | AI reports error, imported forest has no boundary |
| 8 | Upload without providing property ID | AI previews, asks "What property ID?", waits |

---

## 11. Success Criteria

1. ✅ User uploads CSV in chat → AI detects kuviotiedot format → shows stand count + volume
2. ✅ AI asks for missing property ID and forest name before importing
3. ✅ Non-standard CSV (different delimiter, English columns) is automatically converted
4. ✅ Failed parse gives clear error with suggestions
5. ✅ After import, forest appears in dashboard forest list immediately
6. ✅ Temporary files are cleaned up when conversation resets
