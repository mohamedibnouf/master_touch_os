export {};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
};

type GoogleTokenClientError = {
  type?: string;
  message?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

type GoogleDocsView = {
  setIncludeFolders: (include: boolean) => GoogleDocsView;
  setSelectFolderEnabled: (enabled: boolean) => GoogleDocsView;
  setMimeTypes: (types: string) => GoogleDocsView;
};

type GooglePickerBuilder = {
  addView: (view: GoogleDocsView | string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId?: (appId: string) => GooglePickerBuilder;
  setCallback: (callback: (data: GooglePickerCallbackData) => void) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  setLocale: (locale: string) => GooglePickerBuilder;
  setMaxItems?: (max: number) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};

type GooglePickerCallbackData = {
  action: string;
  docs?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    url?: string;
    type?: string;
    sizeBytes?: number;
  }>;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: GoogleTokenClientError) => void;
          }) => GoogleTokenClient;
        };
      };
      picker?: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new (viewId?: string) => GoogleDocsView;
        ViewId: {
          DOCS: string;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
          LOADED: string;
        };
      };
    };
    gapi?: {
      load: (
        api: string,
        callback: (() => void) | { callback: () => void; onerror?: () => void },
      ) => void;
    };
  }
}
