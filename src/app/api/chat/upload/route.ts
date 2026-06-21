import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    const filename = file.name;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext !== "csv") {
      return NextResponse.json({ error: "Only CSV files are accepted" }, { status: 400 });
    }

    const uploadDir = join("/tmp", "chat-uploads", user.id);
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }

    const timestamp = Date.now();
    const savedPath = join(uploadDir, `${timestamp}.csv`);

    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(savedPath, buffer);

    return NextResponse.json({
      success: true,
      path: savedPath,
      filename,
      size: buffer.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
