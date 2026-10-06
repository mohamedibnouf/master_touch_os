import "client-only";

import { requestGoogleDriveFileAccessToken, googlePickerErrorFromUnknown } from "./google-gis";
import { googlePickerErrorMessage, type GooglePickerUiError } from "./google-picker-errors";
import { normalizeGooglePickerDocument, type NormalizedGooglePickerFile } from "./google-picker-normalize";
import { loadGooglePickerScript } from "./google-script-loader";
import { googlePickerAppIdFromClientId } from "./drive-ai-auth";

export type GooglePickerSelectResult =
  | { ok: true; file: NormalizedGooglePickerFile }
  | { ok: false; code: GooglePickerUiError; message: string };

function fail(code: GooglePickerUiError): GooglePickerSelectResult {
  return { ok: false, code, message: googlePickerErrorMessage(code) };
}

export async function pickGoogleDriveFile(input: {
  clientId: string;
  apiKey: string;
  interactive?: boolean;
  title?: string;
}): Promise<GooglePickerSelectResult> {
  try {
    const token = await requestGoogleDriveFileAccessToken(input.clientId, {
      interactive: Boolean(input.interactive),
    });
    await loadGooglePickerScript();
    const pickerApi = window.google?.picker;
    if (!pickerApi) return fail("script_failed");

    return await new Promise<GooglePickerSelectResult>((resolve) => {
      const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);

      const builder = new pickerApi.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(input.apiKey)
        .setOrigin(window.location.origin)
        .setLocale("ar")
        .setCallback((data) => {
          if (data.action === pickerApi.Action.LOADED) return;
          if (data.action === pickerApi.Action.CANCEL) {
            resolve(fail("picker_cancelled"));
            return;
          }
          if (data.action !== pickerApi.Action.PICKED) return;
          const file = normalizeGooglePickerDocument(data.docs?.[0]);
          if (!file) {
            resolve(fail("invalid_selection"));
            return;
          }
          resolve({ ok: true, file });
        });

      const appId = googlePickerAppIdFromClientId(input.clientId);
      if (appId) builder.setAppId?.(appId);
      if (input.title) builder.setTitle(input.title);

      builder.build().setVisible(true);
    });
  } catch (error) {
    const code = googlePickerErrorFromUnknown(error);
    return fail(code);
  }
}
