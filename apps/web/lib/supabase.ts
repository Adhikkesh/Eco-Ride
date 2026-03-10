import { createClient } from "@supabase/supabase-js";

// Initialize the Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Check if the URL is literally the placeholder from .env or totally missing
const isConfigured = supabaseUrl && supabaseUrl.startsWith("http");

if (!isConfigured) {
  console.warn(
    "Supabase credentials are not properly defined in the environment variables. " +
    "Document uploads will fail."
  );
}

export const supabase = createClient(
  isConfigured ? (supabaseUrl as string) : "https://placeholder-project.supabase.co",
  isConfigured ? (supabaseAnonKey as string) : "placeholder-anon-key"
);

/**
 * Uploads a file to a specified Supabase Storage bucket.
 * 
 * @param bucketName The name of the Supabase storage bucket (e.g., 'documents')
 * @param path The path/filename within the bucket
 * @param file The File object to upload
 * @returns The public URL of the uploaded file
 */
export const uploadToSupabase = async (
  bucketName: string,
  path: string,
  file: File
): Promise<string> => {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: true, // Replace if exists
    });

  if (error) {
    console.error("Supabase upload error:", error);
    throw new Error(`Failed to upload document: ${error.message}`);
  }

  // Get the public URL for the uploaded file
  const { data: urlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(data.path);

  return urlData.publicUrl;
};
