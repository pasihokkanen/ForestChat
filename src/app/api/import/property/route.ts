import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPropertyBoundary } from "@/lib/import/mml-client";
import { env } from "@/lib/env";
import { NextResponse, type NextRequest } from "next/server";

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

    // 2. Parse request body
    const body = await request.json();
    const { property_id, name } = body;

    if (!property_id || typeof property_id !== "string") {
      return NextResponse.json(
        { error: "property_id (kiinteistötunnus) is required" },
        { status: 400 }
      );
    }

    const forestName = name || `Forest ${property_id}`;

    // 3. Fetch property boundary from MML
    const boundary = await fetchPropertyBoundary(property_id, env.mmlApiKey);

    if (!boundary) {
      return NextResponse.json(
        {
          error: `Property ${property_id} not found. Check the ID and try again.`,
        },
        { status: 404 }
      );
    }

    // 4. Create forest record
    const admin = createAdminClient();
    const { data: forest, error: forestError } = await admin
      .from("forests")
      .insert({
        owner_id: user.id,
        name: forestName,
        property_id,
        data_source: "mml_wfs",
      })
      .select()
      .single();

    if (forestError || !forest) {
      throw new Error(
        `Failed to create forest: ${forestError?.message}`
      );
    }

    // 5. Store property boundary
    const { error: boundaryError } = await admin
      .from("property_boundaries")
      .upsert({
        forest_id: forest.id,
        property_id,
        geometry: boundary.geometry,
        fetched_at: new Date().toISOString(),
      });

    if (boundaryError) {
      throw new Error(
        `Failed to store boundary: ${boundaryError.message}`
      );
    }

    // 6. Fetch stands from Metsäkeskus WFS
    const { fetchStandsByBbox, bboxFromGeometry } = await import(
      "@/lib/import/wfs-client"
    );
    const bbox = bboxFromGeometry(boundary.geometry);
    const stands = await fetchStandsByBbox(bbox);

    if (stands.length === 0) {
      // Update forest with area even if no stands
      await admin
        .from("forests")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", forest.id);

      return NextResponse.json({
        forest_id: forest.id,
        property_id,
        total_area_ha: boundary.areaM2
          ? Math.round((boundary.areaM2 / 10000) * 100) / 100
          : null,
        compartment_count: 0,
        warning:
          "No stands found within the property bounding box.",
      });
    }

    // 7. Spatial filter and store stands
    const { filterStandsWithinProperty } = await import(
      "@/lib/import/spatial-service"
    );
    const filteredStands = await filterStandsWithinProperty(
      boundary.geometry,
      stands,
      forest.id
    );

    const finalCount = filteredStands.length;
    const totalAreaHa = boundary.areaM2
      ? Math.round((boundary.areaM2 / 10000) * 100) / 100
      : null;

    await admin
      .from("forests")
      .update({
        total_area_ha: totalAreaHa,
        updated_at: new Date().toISOString(),
      })
      .eq("id", forest.id);

    return NextResponse.json({
      forest_id: forest.id,
      property_id,
      total_area_ha: totalAreaHa,
      compartment_count: finalCount,
      fetched_stands: stands.length,
      filtered_out: stands.length - finalCount,
      plot_count: boundary.plotCount,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Import failed unexpectedly",
      },
      { status: 500 }
    );
  }
}
