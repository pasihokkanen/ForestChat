import { createServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { NextResponse, type NextRequest } from "next/server";
import { parseForestDataCsv } from "@/lib/import/csv-parser";
import { importStandsFromCsv } from "@/lib/import/csv-importer";

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse multipart form
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const propertyId = formData.get("property_id") as string | null;
    const name = (formData.get("name") as string) || undefined;

    if (!file)
      return NextResponse.json(
        { error: "CSV file is required" },
        { status: 400 }
      );
    if (!propertyId)
      return NextResponse.json(
        { error: "property_id is required" },
        { status: 400 }
      );

    // 3. Parse CSV
    const csvText = await file.text();
    let csvData;
    try {
      csvData = parseForestDataCsv(csvText);
    } catch (parseErr) {
      return NextResponse.json(
        {
          error: `CSV parse error: ${
            parseErr instanceof Error ? parseErr.message : "Invalid format"
          }`,
        },
        { status: 400 }
      );
    }
    if (csvData.totalStands === 0) {
      return NextResponse.json(
        { error: "CSV contains no stand data" },
        { status: 400 }
      );
    }

    // 4. Import (importer is self-cleaning: deletes forest on failure)
    const result = await importStandsFromCsv(
      csvData,
      propertyId,
      name || `Forest ${propertyId}`,
      user.id,
      env.mmlApiKey,
      supabase
    );

    return NextResponse.json({
      forest_id: result.forestId,
      property_id: result.propertyId,
      stands_imported: result.standsImported,
      stands_with_geometry: result.standsWithGeometry,
      species_rows: result.speciesRowsImported,
      total_volume_m3: result.totalVolumeM3,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error("CSV import error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Import failed unexpectedly",
      },
      { status: 500 }
    );
  }
}
