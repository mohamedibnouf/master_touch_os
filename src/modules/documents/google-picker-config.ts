export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
export const GAPI_SCRIPT_SRC = "https://apis.google.com/js/api.js";

export type GooglePickerPublicEnv = {
  NEXT_PUBLIC_GOOGLE_PICKER_ENABLED?: string;
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?: string;
  NEXT_PUBLIC_GOOGLE_PICKER_API_KEY?: string;
};

export type GooglePickerPublicConfig = {
  enabledFlag: boolean;
  clientId: string;
  apiKey: string;
};

export function readGooglePickerPublicConfig(env: GooglePickerPublicEnv): GooglePickerPublicConfig {
  return {
    enabledFlag: env.NEXT_PUBLIC_GOOGLE_PICKER_ENABLED === "true",
    clientId: (env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "").trim(),
    apiKey: (env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? "").trim(),
  };
}

/** Picker is on only when the flag is true and both public identifiers are present. */
export function isGooglePickerReady(config: GooglePickerPublicConfig): boolean {
  return config.enabledFlag && config.clientId.length > 0 && config.apiKey.length > 0;
}

export function readGooglePickerReadyFromProcess(
  env: GooglePickerPublicEnv = {
    NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_PICKER_ENABLED,
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
  },
): boolean {
  return isGooglePickerReady(readGooglePickerPublicConfig(env));
}
