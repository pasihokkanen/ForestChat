import { NextResponse } from "next/server";
import { deleteForestById } from "@/lib/repos/forests";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Forest ID is required" },
        { status: 400 }
      );
    }

    const result = await deleteForestById(id);

    if (!result.deleted) {
      return NextResponse.json(
        { error: "Forest not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      deleted: true,
      forest_id: result.forest?.id,
      name: result.forest?.name,
    });
  } catch (error) {
    console.error("Delete forest error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete forest",
      },
      { status: 500 }
    );
  }
}
