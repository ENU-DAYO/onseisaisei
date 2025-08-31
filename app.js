(() => {
  // -------- IndexedDB ヘルパ --------
  const DB_NAME = 'soundpad';
  const DB_VERSION = 1;
  const STORE = 'sounds';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains(STORE)) {
          const store = _db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('key', 'key', { unique: false });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(storeMode = 'readonly') {
    if (!db) throw new Error('DB 未初期化');
    return db.transaction([STORE], storeMode).objectStore(STORE);
  }

  function addSound(data) {
    return new Promise((resolve, reject) => {
      const req = tx('readwrite').add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function updateSound(data) {
    return new Promise((resolve, reject) => {
      const req = tx('readwrite').put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function deleteSound(id) {
    return new Promise((resolve, reject) => {
      const req = tx('readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function getAllSounds() {
    return new Promise((resolve, reject) => {
      const req = tx('readonly').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // -------- ユーティリティ --------
  function displayKey(eOrCode) {
    if (typeof eOrCode === 'string') return eOrCode;
    const e = eOrCode;
    if (e.code === 'Space') return 'Space';
    if (e.key.length === 1) return e.key.toUpperCase();
    return e.code || e.key;
  }

  function toTimeLabel(seconds) {
    if (!isFinite(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function createURLFromBlob(blob) {
    return URL.createObjectURL(blob);
  }

  function playFromBlob(blob) {
    const url = createURLFromBlob(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play().catch(() => {});
    return audio;
  }

  const activeAudios = [];
  function stopAll() {
    for (const a of activeAudios.splice(0)) {
      try { a.pause(); a.currentTime = 0; } catch {}
    }
  }

  // -------- DOM 参照 --------
  const form = document.getElementById('addForm');
  const nameInput = document.getElementById('nameInput');
  const keyBtn = document.getElementById('keyCaptureBtn');
  const keyValue = document.getElementById('keyValue');
  const fileInput = document.getElementById('fileInput');
  const fileNamePreview = document.getElementById('fileNamePreview');
  const fileBtnLabel = document.getElementById('fileBtnLabel');
  const clearFormBtn = document.getElementById('clearFormBtn');

  const list = document.getElementById('soundList');
  const itemTpl = document.getElementById('soundItemTemplate');

  const stopAllBtn = document.getElementById('stopAllBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');
  const importBtnLabel = document.getElementById('importBtnLabel');

  // モーダル要素
  const renameModal = document.getElementById('renameModal');
  const renameInput = document.getElementById('renameInput');
  const renameCancel = document.getElementById('renameCancel');
  const renameConfirm = document.getElementById('renameConfirm');

  // -------- 状態 --------
  let sounds = [];
  const keyMap = new Map();

  // フォームでのキーキャプチャ
  let capturing = false;
  keyBtn.addEventListener('click', () => {
    capturing = true;
    keyBtn.classList.add('capturing');
    keyBtn.textContent = 'キーを押してください…';
    // フォーカスを外してキーダウンで拾えるようにする
    keyBtn.blur();
  });

  // ファイル選択UIの強化：ファイル名プレビューとプレースホルダー
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) {
      fileNamePreview.textContent = f.name;
      nameInput.placeholder = f.name;
      // 小さなアニメーションでファイル名を点滅させる
      fileNamePreview.animate([{opacity:0.4},{opacity:1}], {duration:320, easing:'ease-out'});
    } else {
      fileNamePreview.textContent = '選択されていません';
      nameInput.placeholder = 'ファイル名を入力';
    }
  });

  // インポートボタンのラベルでも input を開けるようにする
  importBtnLabel.addEventListener('click', () => {
    importInput.click();
  });

  // ウィンドウの keydown（グローバル操作）
  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const editable = document.activeElement && (document.activeElement.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA');

    // スペースで全停止（入力中は無効）
    if (!editable && (e.code === 'Space' || e.key === ' ')) {
      e.preventDefault();
      stopAll();
      return;
    }

    // キャプチャ中ならフォームへ反映
    if (capturing) {
      e.preventDefault();
      const keyStr = displayKey(e);
      keyValue.value = keyStr;
      keyBtn.textContent = keyStr;
      keyBtn.classList.remove('capturing');
      capturing = false;
      return;
    }

    // 再生（グローバル）
    if (!editable) {
      const keyStr = displayKey(e);
      const targets = keyMap.get(keyStr);
      if (targets && targets.length) {
        for (const snd of targets) {
          const a = playFromBlob(snd.blob);
          activeAudios.push(a);
          // 再生時のビジュアル反応（カードを短時間アニメ）
          const el = document.querySelector(`[data-id="${snd.id}"]`);
          if (el) {
            el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
          }
        }
      }
    }
  });

  clearFormBtn.addEventListener('click', () => {
    form.reset();
    keyBtn.textContent = '未設定';
    keyValue.value = '';
    fileNamePreview.textContent = '選択されていません';
    nameInput.placeholder = 'ファイル名を入力';
  });

  // -------- 追加処理 --------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    if (!file) { alert('音声ファイルを選択してください'); return; }

    const displayName = (nameInput.value || file.name).trim();
    const blob = file.slice(0, file.size, file.type);

    const duration = await probeDuration(blob).catch(() => undefined);

    const data = {
      name: displayName,
      key: keyValue.value || null,
      blob,
      createdAt: Date.now(),
      duration
    };

    const id = await addSound(data);
    data.id = id;
    sounds.push(data);
    rebuildKeyMap();
    renderList();

    form.reset();
    keyBtn.textContent = '未設定';
    keyValue.value = '';
    fileNamePreview.textContent = '選択されていません';
    nameInput.placeholder = '例：ジャンプ';
  });

  function probeDuration(blob) {
    return new Promise((resolve, reject) => {
      const url = createURLFromBlob(blob);
      const a = new Audio(url);
      const cleanup = () => URL.revokeObjectURL(url);
      a.addEventListener('loadedmetadata', () => {
        const d = a.duration;
        cleanup();
        resolve(isFinite(d) ? d : undefined);
      }, { once:true });
      a.addEventListener('error', () => { cleanup(); reject(); }, { once:true });
    });
  }

  // -------- リスト描画 --------
  function rebuildKeyMap() {
    keyMap.clear();
    for (const s of sounds) {
      if (!s.key) continue;
      if (!keyMap.has(s.key)) keyMap.set(s.key, []);
      keyMap.get(s.key).push(s);
    }
  }

  function renderList() {
    list.innerHTML = '';
    const sorted = [...sounds].sort((a,b)=>b.createdAt - a.createdAt);
    for (const s of sorted) {
      const node = itemTpl.content.firstElementChild.cloneNode(true);
      // data-id を付与してアニメや参照を容易にする
      node.setAttribute('data-id', s.id);

      const title = node.querySelector('.card__title');
      const badge = node.querySelector('.key-badge');
      const durEl = node.querySelector('.duration');

      title.textContent = s.name;
      badge.textContent = s.key || '—';
      durEl.textContent = toTimeLabel(s.duration ?? NaN);

      // 再生
      node.querySelector('.play').addEventListener('click', () => {
        const a = playFromBlob(s.blob);
        activeAudios.push(a);
      });

      // キー変更（ボタン）
      node.querySelector('.rebind').addEventListener('click', async () => {
        badge.textContent = '…';
        const key = await waitNextKey();
        s.key = key;
        badge.textContent = key;
        await updateSound(s);
        rebuildKeyMap();
      });

      // キー変更（バッジクリックでも可能）
      badge.addEventListener('click', async () => {
        badge.textContent = '…';
        const key = await waitNextKey();
        s.key = key;
        badge.textContent = key;
        await updateSound(s);
        rebuildKeyMap();
      });

      // 名前変更（カスタムモーダル）
      node.querySelector('.rename').addEventListener('click', async () => {
        openRenameModal(s);
      });

      // 音源差し替え
      node.querySelector('.replace').addEventListener('click', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.onchange = async () => {
          const f = input.files && input.files[0];
          if (!f) return;
          s.blob = f.slice(0, f.size, f.type);
          s.duration = await probeDuration(s.blob).catch(()=>s.duration);
          durEl.textContent = toTimeLabel(s.duration ?? NaN);
          await updateSound(s);
        };
        input.click();
      });

      // 削除
node.querySelector('.delete').addEventListener('click', async () => {
  openDeleteModal(s);
});

      list.appendChild(node);
    }
  }

  function waitNextKey() {
    return new Promise(resolve => {
      const handler = (e) => {
        e.preventDefault();
        window.removeEventListener('keydown', handler, true);
        resolve(displayKey(e));
      };
      window.addEventListener('keydown', handler, true);
    });
  }

  // -------- エクスポート / インポート --------
exportBtn.addEventListener('click', async () => {
  const all = await getAllSounds();
  const serializable = await Promise.all(all.map(async s => ({
    id: s.id,
    name: s.name,
    key: s.key,
    createdAt: s.createdAt,
    duration: s.duration ?? null,
    blobType: s.blob.type,
    blobB64: await blobToBase64(s.blob)
  })));

  const json = JSON.stringify({ version: 1, items: serializable }, null, 2);
  const file = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(file);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'soundpad_export.json';
  document.body.appendChild(a);
  a.click();
  // 少し遅らせて revoke & remove（安全対策）
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 500);
});

  importInput.addEventListener('change', async () => {
    const f = importInput.files && importInput.files[0];
    if (!f) return;

    try {
      const text = await f.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.items)) throw new Error('不正な形式');

      for (const item of data.items) {
        const blob = base64ToBlob(item.blobB64, item.blobType || 'audio/mpeg');
        const rec = {
          name: item.name || 'Imported',
          key: item.key || null,
          blob,
          createdAt: item.createdAt || Date.now(),
          duration: item.duration ?? undefined
        };
        const id = await addSound(rec);
        rec.id = id;
        sounds.push(rec);
      }
      rebuildKeyMap();
      renderList();
      importInput.value = '';
      alert('インポートが完了しました');
    } catch {
      alert('インポートに失敗しました。ファイル形式を確認してください。');
    }
  });

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const result = fr.result;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64, type='application/octet-stream') {
    const bin = atob(base64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  // -------- モーダル（リネーム）ロジック --------
  let pendingRenameTarget = null;
  function openRenameModal(soundObj) {
    pendingRenameTarget = soundObj;
    renameInput.value = soundObj.name || '';
    renameModal.setAttribute('aria-hidden', 'false');
    // フォーカスと選択
    setTimeout(() => renameInput.focus(), 120);
  }

  function closeRenameModal() {
    pendingRenameTarget = null;
    renameModal.setAttribute('aria-hidden', 'true');
    renameInput.value = '';
  }

  renameCancel.addEventListener('click', () => {
    closeRenameModal();
  });

  // モーダル背景クリックで閉じる
  renameModal.querySelector('[data-dismiss="modal"]').addEventListener('click', () => {
    closeRenameModal();
  });

  // 保存
  renameConfirm.addEventListener('click', async () => {
    if (!pendingRenameTarget) { closeRenameModal(); return; }
    const newName = renameInput.value && renameInput.value.trim();
    if (newName) {
      pendingRenameTarget.name = newName;
      await updateSound(pendingRenameTarget);
      // 画面更新
      renderList();
    }
    closeRenameModal();
  });

  // Enter で確定、Escでキャンセル
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      renameConfirm.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renameCancel.click();
    }
  });

  // -------- 初期化 --------
  stopAllBtn.addEventListener('click', stopAll);

  openDB().then(async () => {
    sounds = await getAllSounds();
    rebuildKeyMap();
    renderList();
  }).catch((err) => {
    console.error(err);
    alert('データベースの初期化に失敗しました。ページを再読み込みしてください。');
  });

// モーダル参照（既存の renameModal と並べて）
const deleteModal = document.getElementById('deleteModal');
const deleteConfirm = document.getElementById('deleteConfirm');
const deleteCancel = document.getElementById('deleteCancel');
const deleteTargetName = document.getElementById('deleteTargetName');

let pendingDeleteTarget = null;

function openDeleteModal(soundObj) {
  pendingDeleteTarget = soundObj;
  deleteTargetName.textContent = soundObj.name || '(無名)';
  deleteModal.setAttribute('aria-hidden', 'false');
  // フォーカス移動（アクセシビリティ）
  setTimeout(() => deleteConfirm.focus(), 120);
}

function closeDeleteModal() {
  pendingDeleteTarget = null;
  deleteModal.setAttribute('aria-hidden', 'true');
}

// モーダルのキャンセル
deleteCancel.addEventListener('click', () => {
  closeDeleteModal();
});

// バックドロップクリックで閉じる
deleteModal.querySelector('[data-dismiss="modal"]').addEventListener('click', () => {
  closeDeleteModal();
});

// 確定（削除）
deleteConfirm.addEventListener('click', async () => {
  if (!pendingDeleteTarget) { closeDeleteModal(); return; }
  try {
    await deleteSound(pendingDeleteTarget.id);
    sounds = sounds.filter(x => x.id !== pendingDeleteTarget.id);
    rebuildKeyMap();
    renderList();
  } catch (err) {
    console.error(err);
    alert('削除に失敗しました');
  }
  closeDeleteModal();
});

// Esc でキャンセルできるように（任意）
deleteModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeDeleteModal();
  }
});

})();
