(async () => {
  const storageKey = "freegroup-shareable-notepad-v1";
  const historyKey = "freegroup-shareable-notepad-history-v1";
  const historyLimit = 3;
  const saveInterval = 5000;
  const pinKdfIterations = 600000;
  const editor = document.getElementById("note-editor");
  const autosaveStatus = document.getElementById("autosave-status");
  const pasteButton = document.getElementById("paste-button");
  const historyButton = document.getElementById("history-button");
  const historyPanel = document.getElementById("history-panel");
  const historyEmpty = document.getElementById("history-empty");
  const historyList = document.getElementById("history-list");
  const shareButton = document.getElementById("share-button");
  const shareToast = document.getElementById("share-toast");
  const pinShareToggle = document.getElementById("pin-share-toggle");
  const pinDialog = document.getElementById("pin-dialog");
  const pinForm = document.getElementById("pin-form");
  const pinTitle = document.getElementById("pin-dialog-title");
  const pinDescription = document.getElementById("pin-dialog-description");
  const pinInput = document.getElementById("pin-input");
  const pinConfirmRow = document.getElementById("pin-confirm-row");
  const pinConfirm = document.getElementById("pin-confirm");
  const pinError = document.getElementById("pin-error");
  const pinCancel = document.getElementById("pin-cancel");
  let saveTimer;
  let toastTimer;
  let resolvePinPrompt;

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
    if (hash.startsWith("#z1=")) {
      return { found: true, mode: "plain", payload: hash.slice(4) };
    }
    if (hash.startsWith("#s1.")) {
      const [version, iterations, salt, iv, ciphertext, ...extra] = hash.slice(1).split(".");
      if (
        version === "s1" &&
        iterations === String(pinKdfIterations) &&
        salt && iv && ciphertext && extra.length === 0
      ) {
        return { found: true, mode: "secure", salt, iv, ciphertext };
      }
    }
    return { found: true, mode: "invalid" };
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
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid share data");
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
    return decompressBytes(bytes);
  }

  async function decompressBytes(bytes) {
    const decompressed = await transformBytes(bytes, window.DecompressionStream, "gzip");
    return new TextDecoder().decode(decompressed);
  }

  async function derivePinKey(pin, salt, usages) {
    if (!window.crypto?.subtle) throw new Error("Secure sharing requires a secure browser connection");
    const material = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: pinKdfIterations,
        hash: "SHA-256"
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      usages
    );
  }

  async function encryptSharePayload(pin, compressed) {
    if (!window.crypto?.getRandomValues || !window.crypto?.subtle) {
      throw new Error("Secure sharing requires HTTPS and Web Crypto");
    }
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await derivePinKey(pin, salt, ["encrypt"]);
    const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed);
    return [
      "s1",
      pinKdfIterations,
      bytesToBase64Url(salt),
      bytesToBase64Url(iv),
      bytesToBase64Url(new Uint8Array(ciphertext))
    ].join(".");
  }

  async function decryptSharePayload(sharedNote, pin) {
    const salt = base64UrlToBytes(sharedNote.salt);
    const iv = base64UrlToBytes(sharedNote.iv);
    const ciphertext = base64UrlToBytes(sharedNote.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) {
      throw new Error("Invalid secure share data");
    }
    const key = await derivePinKey(pin, salt, ["decrypt"]);
    const plaintext = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new Uint8Array(plaintext);
  }

  function promptForPin(mode, message = "") {
    pinTitle.textContent = mode === "create" ? "Set a 4-digit PIN" : "Enter the 4-digit PIN";
    pinDescription.textContent = mode === "create"
      ? "Share this PIN with the recipient separately from the link."
      : "Enter the PIN provided by the person who shared this note.";
    pinConfirmRow.hidden = mode !== "create";
    pinConfirm.disabled = mode !== "create";
    pinConfirm.required = mode === "create";
    pinError.textContent = message;
    pinInput.value = "";
    pinConfirm.value = "";
    pinInput.autocomplete = mode === "create" ? "new-password" : "off";

    return new Promise((resolve) => {
      resolvePinPrompt = resolve;
      pinDialog.showModal();
      pinInput.focus();
    });
  }

  function closePinPrompt(value) {
    if (!resolvePinPrompt) return;
    const resolve = resolvePinPrompt;
    resolvePinPrompt = null;
    pinDialog.close();
    resolve(value);
  }

  pinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const pin = pinInput.value;
    if (!/^\d{4}$/.test(pin)) {
      pinError.textContent = "Enter exactly 4 digits.";
      pinInput.focus();
      return;
    }
    if (!pinConfirmRow.hidden && pin !== pinConfirm.value) {
      pinError.textContent = "The PINs do not match.";
      pinConfirm.focus();
      return;
    }
    closePinPrompt(pin);
  });

  pinCancel.addEventListener("click", () => closePinPrompt(null));
  pinDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePinPrompt(null);
  });

  function readHistory() {
    try {
      const entries = JSON.parse(window.localStorage.getItem(historyKey) || "[]");
      if (!Array.isArray(entries)) return [];
      return entries
        .filter((entry) => entry && typeof entry.text === "string" && Number.isFinite(entry.savedAt))
        .slice(0, historyLimit);
    } catch {
      return [];
    }
  }

  function archivePreviousNote(text) {
    if (!text || text === editor.value) return;

    const history = readHistory().filter((entry) => entry.text !== text);
    history.unshift({ text, savedAt: Date.now() });

    try {
      window.localStorage.setItem(historyKey, JSON.stringify(history.slice(0, historyLimit)));
    } catch {
      // Keep autosave working even if there is no room for another history entry.
    }
  }

  function renderHistory() {
    const history = readHistory();
    historyList.replaceChildren();
    historyEmpty.hidden = history.length > 0;
    historyList.hidden = history.length === 0;

    history.forEach((entry) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const preview = document.createElement("span");
      const savedAt = new Date(entry.savedAt);
      const timestamp = document.createElement("span");

      button.className = "history-item";
      button.type = "button";
      button.setAttribute("aria-label", `Restore note saved ${savedAt.toLocaleString()}`);
      preview.className = "history-preview";
      const previewText = entry.text.replace(/\s+/g, " ");
      preview.textContent = previewText
        ? previewText.slice(0, 160) + (previewText.length > 160 ? "…" : "")
        : "(Empty note)";
      timestamp.className = "history-time";
      timestamp.textContent = `Saved ${savedAt.toLocaleString()}`;
      button.append(preview, timestamp);
      button.addEventListener("click", () => restoreHistoryNote(entry));
      item.append(button);
      historyList.append(item);
    });
  }

  function restoreHistoryNote(entry) {
    editor.value = entry.text;
    editor.focus();
    historyPanel.hidden = true;
    historyButton.setAttribute("aria-expanded", "false");

    const saved = saveNow();
    showToast(saved ? "Previous note restored" : "Restored in this tab; autosave is unavailable");
  }

  function saveNow() {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;

    try {
      const previousNote = window.localStorage.getItem(storageKey);
      if (previousNote !== null) archivePreviousNote(previousNote);
      window.localStorage.setItem(storageKey, editor.value);
      autosaveStatus.textContent = "Saved on this browser";
      renderHistory();
      return true;
    } catch {
      autosaveStatus.textContent = "Autosave is unavailable in this browser";
      return false;
    }
  }

  async function makeShareUrl(pin = null) {
    const compressed = await compressNote(editor.value);
    const url = new URL(window.location.href);
    url.hash = pin
      ? await encryptSharePayload(pin, compressed)
      : `z1=${bytesToBase64Url(compressed)}`;
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
      const pin = pinShareToggle.checked ? await promptForPin("create") : null;
      if (pinShareToggle.checked && pin === null) return;
      url = await makeShareUrl(pin);
    } catch (error) {
      showToast(error?.message === "Secure sharing requires HTTPS and Web Crypto"
        ? error.message
        : "Could not prepare this share link");
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
  historyButton.addEventListener("click", () => {
    const opening = historyPanel.hidden;
    historyPanel.hidden = !opening;
    historyButton.setAttribute("aria-expanded", String(opening));
    if (opening) renderHistory();
  });
  shareButton.addEventListener("click", copyCurrentShareUrl);
  window.addEventListener("pagehide", saveNow);

  const sharedNote = readSharedNote();
  if (sharedNote.found) {
    editor.readOnly = true;
    autosaveStatus.textContent = "Opening shared note…";
    let secureOpenUnsupported = false;

    try {
      if (sharedNote.mode === "plain") {
        editor.value = await decompressNote(sharedNote.payload);
      } else if (sharedNote.mode === "secure") {
        if (!window.crypto?.subtle) {
          secureOpenUnsupported = true;
          throw new Error("Web Crypto is unavailable");
        }
        let compressed;
        let cancelled = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const pin = await promptForPin(
            "open",
            attempt > 0 ? "That PIN did not open the note. Try again." : ""
          );
          if (pin === null) {
            cancelled = true;
            break;
          }
          try {
            compressed = await decryptSharePayload(sharedNote, pin);
            break;
          } catch {
            // AES-GCM rejects incorrect PINs and altered share data the same way.
          }
        }
        if (cancelled) {
          const restored = restoreLocalNote();
          autosaveStatus.textContent = restored
            ? "PIN entry cancelled; this browser’s note was kept."
            : "PIN entry cancelled; autosave is unavailable.";
          return;
        }
        if (!compressed) throw new Error("Incorrect PIN or damaged secure share");
        editor.value = await decompressBytes(compressed);
      } else {
        throw new Error("Unsupported share link");
      }
      clearSharedHash();
      const saved = saveNow();
      autosaveStatus.textContent = saved
        ? "Shared note opened and saved on this browser"
        : "Shared note opened; autosave is unavailable";
    } catch {
      const restored = restoreLocalNote();
      if (secureOpenUnsupported) {
        autosaveStatus.textContent = restored
          ? "Secure sharing is unavailable in this browser; this browser’s note was kept."
          : "Secure sharing is unavailable in this browser; autosave is unavailable.";
      } else if (sharedNote.mode === "secure") {
        autosaveStatus.textContent = restored
          ? "Could not open secure note. PIN may be wrong or link damaged; this browser’s note was kept."
          : "Could not open secure note. PIN may be wrong or link damaged; autosave is unavailable.";
      } else {
        autosaveStatus.textContent = restored
          ? "Share link is damaged or unsupported. Restored this browser’s note if available."
          : "Share link is damaged or unsupported. Autosave is unavailable.";
      }
    } finally {
      editor.readOnly = false;
    }
  } else {
    autosaveStatus.textContent = restoreLocalNote()
      ? "Autosaves in this browser every 5 seconds"
      : "Autosave is unavailable in this browser";
  }

})();
