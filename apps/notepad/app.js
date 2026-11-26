(async () => {
  const storageKey = "freegroup-shareable-notepad-v1";
  const saveInterval = 5000;
  const editor = document.getElementById("note-editor");
  const autosaveStatus = document.getElementById("autosave-status");
  const pasteButton = document.getElementById("paste-button");
  const shareButton = document.getElementById("share-button");
  const shareToast = document.getElementById("share-toast");
  let saveTimer;
  let toastTimer;

  function showToast(message) {
    shareToast.textContent = message;
    shareToast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      shareToast.hidden = true;
    }, 2400);
  }

  function clearSharedHash() {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search
    );
  }

  function readSharedNote() {
    const hash = window.location.hash;
    if (!hash) return { found: false };
    return {
      found: true,
      payload: hash.startsWith("#z1=") ? hash.slice(4) : ""
    };
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function base64UrlToBytes(value) {
    const base64 = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  async function transformBytes(bytes, Transform, format) {
    if (typeof Transform !== "function") {
      throw new Error("Compression is unavailable in this browser");
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new Transform(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function compressNote(text) {
    const bytes = new TextEncoder().encode(text);
    return transformBytes(bytes, window.CompressionStream, "gzip");
  }

  async function decompressNote(payload) {
    const bytes = base64UrlToBytes(payload);
    const decompressed = await transformBytes(bytes, window.DecompressionStream, "gzip");
    return new TextDecoder().decode(decompressed);
  }

  function saveNow() {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;

    try {
      window.localStorage.setItem(storageKey, editor.value);
      autosaveStatus.textContent = "Saved on this browser";
      return true;
    } catch {
      autosaveStatus.textContent = "Autosave is unavailable in this browser";
      return false;
    }
  }

  async function makeShareUrl() {
    const compressed = await compressNote(editor.value);
    const url = new URL(window.location.href);
    url.hash = `z1=${bytesToBase64Url(compressed)}`;
    return url.toString();
  }

  function restoreLocalNote() {
    try {
      const savedText = window.localStorage.getItem(storageKey);
      if (savedText !== null) editor.value = savedText;
      return true;
    } catch {
      return false;
    }
  }

  async function copyCurrentShareUrl() {
    let url;

    try {
      url = await makeShareUrl();
    } catch {
      showToast("Could not compress this note for sharing");
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
      return;
    } catch {
      const temporaryInput = document.createElement("textarea");
      temporaryInput.value = url;
      temporaryInput.setAttribute("readonly", "");
      temporaryInput.style.position = "fixed";
      temporaryInput.style.opacity = "0";
      document.body.appendChild(temporaryInput);
      temporaryInput.select();
      let copied = false;

      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      temporaryInput.remove();

      showToast(copied ? "Link copied" : "Could not copy link");
    }
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.readText) {
      showToast("Clipboard access unavailable. Try keyboard paste.");
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (text === "") {
        showToast("Clipboard is empty");
        return;
      }

      editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, "end");
      editor.focus();
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      showToast("Text pasted");
    } catch {
      showToast("Could not read clipboard. Try keyboard paste.");
    }
  }

  editor.addEventListener("input", () => {
    autosaveStatus.textContent = "Saving within 5 seconds…";
    if (saveTimer !== undefined) return;

    saveTimer = window.setTimeout(saveNow, saveInterval);
  });

  pasteButton.addEventListener("click", pasteFromClipboard);
  shareButton.addEventListener("click", copyCurrentShareUrl);
  window.addEventListener("pagehide", saveNow);

  const sharedNote = readSharedNote();
  if (sharedNote.found) {
    clearSharedHash();
    editor.readOnly = true;
    autosaveStatus.textContent = "Opening shared note…";

    try {
      editor.value = await decompressNote(sharedNote.payload);
      const saved = saveNow();
      autosaveStatus.textContent = saved
        ? "Shared note opened and saved on this browser"
        : "Shared note opened; autosave is unavailable";
    } catch {
      const restored = restoreLocalNote();
      autosaveStatus.textContent = restored
        ? "This share link could not be opened; restored this browser’s note"
        : "This share link could not be opened; autosave is unavailable";
    } finally {
      editor.readOnly = false;
    }
  } else {
    autosaveStatus.textContent = restoreLocalNote()
      ? "Autosaves in this browser every 5 seconds"
      : "Autosave is unavailable in this browser";
  }

})();
