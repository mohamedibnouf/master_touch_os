import "client-only";

import { GAPI_SCRIPT_SRC, GIS_SCRIPT_SRC } from "./google-picker-config";

const loaders = new Map<string, Promise<void>>();

function loadExternalScript(src: string, id: string): Promise<void> {
  const existing = loaders.get(id);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const ready = document.getElementById(id) as HTMLScriptElement | null;
    if (ready?.dataset.loaded === "1") {
      resolve();
      return;
    }
    if (ready) {
      ready.addEventListener("load", () => resolve(), { once: true });
      ready.addEventListener("error", () => reject(new Error("script_failed")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => {
      loaders.delete(id);
      reject(new Error("script_failed"));
    };
    document.head.appendChild(script);
  });

  loaders.set(id, promise);
  return promise;
}

export async function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") throw new Error("script_failed");
  if (window.google?.accounts?.oauth2) return;
  await loadExternalScript(GIS_SCRIPT_SRC, "mt-google-gis");
  if (!window.google?.accounts?.oauth2) throw new Error("script_failed");
}

export async function loadGooglePickerScript(): Promise<void> {
  if (typeof window === "undefined") throw new Error("script_failed");
  if (window.google?.picker) return;
  await loadExternalScript(GAPI_SCRIPT_SRC, "mt-google-gapi");
  await new Promise<void>((resolve, reject) => {
    if (window.google?.picker) {
      resolve();
      return;
    }
    if (!window.gapi?.load) {
      reject(new Error("script_failed"));
      return;
    }
    window.gapi.load("picker", {
      callback: () => resolve(),
      onerror: () => reject(new Error("script_failed")),
    });
  });
  if (!window.google?.picker) throw new Error("script_failed");
}
