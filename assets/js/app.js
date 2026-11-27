/* ============================================================
   3D 视觉作品集 — 交互与编辑
   数据保存在浏览器 IndexedDB（每台设备独立），
   可通过「导出备份」拿到一个含全部图片的 JSON，换设备再导入。
   ============================================================ */
(function () {
  'use strict';

  var DB_NAME = 'portfolio-v1';
  var STORE = 'kv';
  var STATE_KEY = 'state';
  var SCHEMA = 1;
  var MAX_IMAGE = 1600;
  var JPEG_QUALITY = 0.82;
  // 导出的单文件成品页带这个标记：只渲染自带数据，不读写浏览器数据库
  var PUBLISHED = !!window.__PUBLISHED__;

  /* ---------------- DOM ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var el = {
    body: document.body,
    head: $('.site-head'),
    chips: $('#chips'),
    grid: $('#grid'),
    count: $('#countLabel'),
    editBadge: $('#editBadge'),
    btnEdit: $('#btnEdit'),
    btnEditLabel: $('#btnEditLabel'),
    factCount: $('#factCount'),
    factCats: $('#factCats'),
    drop: $('#dropzone'),
    btnDrop: $('#btnDrop'),
    fileInput: $('#fileInput'),
    empty: $('#empty'),
    btnEmptyAdd: $('#btnEmptyAdd'),
    editbar: $('#editbar'),
    toast: $('#toast'),
    lb: $('#lightbox'),
    lbImg: $('#lbImg'),
    lbNum: $('#lbNum'),
    lbTotal: $('#lbTotal'),
    lbTitle: $('#lbTitle'),
    lbEn: $('#lbEn'),
    lbCat: $('#lbCat'),
    lbDesc: $('#lbDesc'),
    lbTags: $('#lbTags'),
    lbPrev: $('#lbPrev'),
    lbNext: $('#lbNext'),
    lbClose: $('#lbClose'),
    editor: $('#editor'),
    editorForm: $('#editorForm'),
    editorTitle: $('#editorTitle'),
    imgSlot: $('#imgSlot'),
    imgPreview: $('#imgPreview'),
    imgInput: $('#imgInput'),
    btnPickImage: $('#btnPickImage'),
    fTitle: $('#fTitle'),
    fEn: $('#fEn'),
    fCat: $('#fCat'),
    fTags: $('#fTags'),
    fDesc: $('#fDesc'),
    fContain: $('#fContain'),
    btnDeleteWork: $('#btnDeleteWork'),
    cats: $('#cats'),
    catRows: $('#catRows'),
    catNew: $('#catNew'),
    catAddBtn: $('#catAddBtn'),
    emptyText: $('#emptyText'),
    settings: $('#settings'),
    settingsForm: $('#settingsForm'),
    footMail: $('#footMail'),
    jsonInput: $('#jsonInput'),
    year: $('#year')
  };

  /* ---------------- 状态 ---------------- */
  var state = null;
  var filter = '';
  var editing = false;
  var draft = null;      // 编辑中的作品副本
  var draftIsNew = false;
  var visible = [];      // 当前筛选后的作品
  var lbIndex = -1;      // 灯箱在 visible 中的位置
  var storeOk = true;

  /* ---------------- 存储 ---------------- */
  var db = null;

  function openDB() {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        storeOk = false;      // 例如 file:// 下浏览器不给用数据库
        resolve(null);
      }, 1500);
      var finish = function (v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      };
      if (!('indexedDB' in window)) { storeOk = false; return finish(null); }
      var req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { storeOk = false; return finish(null); }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function () { finish(req.result); };
      req.onerror = function () { storeOk = false; finish(null); };
      req.onblocked = function () { storeOk = false; finish(null); };
    });
  }

  function dbGet(key) {
    return new Promise(function (resolve) {
      if (!db) return resolve(null);
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 900);
      try {
        var tx = db.transaction(STORE, 'readonly');
        var rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = function () {
          if (done) return;
          done = true; clearTimeout(timer); resolve(rq.result || null);
        };
        rq.onerror = function () {
          if (done) return;
          done = true; clearTimeout(timer); resolve(null);
        };
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); resolve(null); }
      }
    });
  }

  function dbSet(key, val) {
    return new Promise(function (resolve) {
      if (!db) return resolve(false);
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  function dbClear() {
    return new Promise(function (resolve) {
      if (!db) return resolve(true);
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      dbSet(STATE_KEY, state).then(function (ok) {
        if (!ok && storeOk) {
          storeOk = false;
          toast('浏览器没能保存数据（可能是隐私模式），刷新后会丢失', true);
        }
      });
    }, 120);
  }

  /* ---------------- 数据 ---------------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function catOf(w) {
    return String((w && w.category) || '').trim() || '未分类';
  }

  function deriveCats(works) {
    var seen = {};
    var out = [];
    (works || []).forEach(function (w) {
      var c = catOf(w);
      if (!seen[c]) { seen[c] = 1; out.push(c); }
    });
    return out;
  }

  function seedState() {
    var s = window.SEED || { site: {}, works: [] };
    var out = clone(s);
    out.version = SCHEMA;
    out.works = (out.works || []).map(function (w, i) {
      return {
        id: w.id || 'w' + (i + 1),
        title: w.title || '未命名作品',
        en: w.en || '',
        category: catOf(w),
        tags: w.tags || [],
        desc: w.desc || '',
        image: w.image || '',
        focus: w.focus || '',
        fit: w.fit || '',
        bg: w.bg || ''
      };
    });
    out.categories = Array.isArray(s.categories) && s.categories.length
      ? s.categories.slice()
      : deriveCats(out.works);
    return out;
  }

  function normalize(s) {
    if (!s || typeof s !== 'object') return seedState();
    var out = {
      version: SCHEMA,
      site: Object.assign({
        brand: '3D 视觉作品集', tagline: '', author: '', role: '',
        intro: '', about: '', email: '', meta: ''
      }, s.site || {}),
      categories: [],
      works: []
    };
    (Array.isArray(s.works) ? s.works : []).forEach(function (w, i) {
      if (!w || typeof w !== 'object') return;
      out.works.push({
        id: w.id || 'w' + Date.now().toString(36) + i,
        title: w.title || '未命名作品',
        en: w.en || '',
        category: catOf(w),
        tags: Array.isArray(w.tags) ? w.tags : String(w.tags || '').split(/[,，、]/).filter(Boolean),
        desc: w.desc || '',
        image: w.image || '',
        focus: w.focus || '',
        fit: w.fit || '',
        bg: w.bg || ''
      });
    });
    // 分类顺序：先取存档里的顺序，再把作品里出现、但没登记的分类补在后面
    var order = (Array.isArray(s.categories) ? s.categories : [])
      .filter(function (c) { return typeof c === 'string' && c.trim(); })
      .map(function (c) { return c.trim(); });
    deriveCats(out.works).forEach(function (c) {
      if (order.indexOf(c) < 0) order.push(c);
    });
    out.categories = order;
    return out;
  }

  // 分类顺序 = 显式登记的顺序 + 作品里冒出来的（兜底，防止数据不一致时丢分类）
  function catOrder() {
    var order = (state.categories || []).slice();
    deriveCats(state.works).forEach(function (c) {
      if (order.indexOf(c) < 0) order.push(c);
    });
    return order;
  }

  function categories() {
    var counts = {};
    state.works.forEach(function (w) {
      var c = catOf(w);
      counts[c] = (counts[c] || 0) + 1;
    });
    return catOrder().map(function (c) {
      return { name: c, count: counts[c] || 0 };
    });
  }

  // 打印 / 存 PDF：先把所有图片加载完，否则打印时懒加载的图会空着
  function printPage() {
    var imgs = Array.prototype.slice.call(document.querySelectorAll('.card-img img, .lb-media img'));
    imgs.forEach(function (im) { im.loading = 'eager'; });
    var waits = imgs.map(function (im) {
      if (im.complete && im.naturalWidth) return Promise.resolve();
      return new Promise(function (res) {
        im.onload = im.onerror = function () { res(); };
        if (im.complete) res();
      });
    });
    Promise.all(waits).then(function () {
      setTimeout(function () { window.print(); }, 150);
    });
  }

  /* ---------------- 分类增删改 ---------------- */

  function findCat(name) {
    var all = catOrder();
    for (var i = 0; i < all.length; i++) {
      if (all[i].toLowerCase() === String(name || '').trim().toLowerCase()) return all[i];
    }
    return null;
  }

  function addCategory(name) {
    name = String(name || '').trim();
    if (!name) return null;
    var exist = findCat(name);
    if (exist) { toast('已经有「' + exist + '」这个分类了', true); return exist; }
    state.categories = catOrder().concat([name]);
    save();
    renderAll();
    toast('已添加分类「' + name + '」');
    return name;
  }

  function renameCategory(oldName, newName) {
    newName = String(newName || '').trim();
    if (!newName) return false;
    if (newName === oldName) return true;
    var exist = findCat(newName);
    if (exist && exist !== oldName) {
      toast('「' + exist + '」已经存在了', true);
      return false;
    }
    state.categories = catOrder().map(function (c) { return c === oldName ? newName : c; });
    state.works.forEach(function (w) {
      if (catOf(w) === oldName) w.category = newName;
    });
    if (filter === oldName) filter = newName;
    save();
    renderAll();
    toast('已改名为「' + newName + '」');
    return true;
  }

  function removeCategory(name) {
    var n = state.works.filter(function (w) { return catOf(w) === name; }).length;
    var msg = n
      ? '删除分类「' + name + '」？\n其中 ' + n + ' 件作品会转到「未分类」。'
      : '删除空分类「' + name + '」？';
    if (!confirm(msg)) return false;
    if (n) {
      state.works.forEach(function (w) {
        if (catOf(w) === name) w.category = '未分类';
      });
    }
    var order = catOrder().filter(function (c) { return c !== name; });
    if (n && order.indexOf('未分类') < 0) order.push('未分类');
    state.categories = order;
    if (filter === name) filter = '';
    save();
    renderAll();
    toast(n ? '已删除，' + n + ' 件作品转到「未分类」' : '已删除分类');
    return true;
  }

  function moveCategory(name, dir) {
    var order = catOrder();
    var i = order.indexOf(name);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    var tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
    state.categories = order;
    save();
    renderAll();
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- 渲染 ---------------- */
  function renderSiteText() {
    var site = state.site;
    $$('[data-site]').forEach(function (node) {
      var key = node.getAttribute('data-site');
      var val = site[key];
      if (typeof val === 'string' && val.trim() !== '') {
        node.textContent = val;
      }
    });
    if (el.footMail && site.email) {
      el.footMail.textContent = site.email;
      el.footMail.href = 'mailto:' + site.email;
    }
    document.title = (site.brand || '作品集') + ' — ' + (site.tagline || '');
  }

  function renderFacts() {
    var cats = categories();
    if (el.factCount) el.factCount.textContent = pad(state.works.length);
    if (el.factCats) el.factCats.textContent = pad(cats.length);
    if (el.count) el.count.textContent = state.works.length + ' 件';
  }

  function renderChips() {
    var cats = categories();
    var html = '<button class="chip" role="tab" data-cat="" aria-selected="' + (filter === '' ? 'true' : 'false') + '">全部 <b>' + state.works.length + '</b></button>';
    cats.forEach(function (c) {
      html += '<button class="chip" role="tab" data-cat="' + escAttr(c.name) + '" aria-selected="' + (filter === c.name ? 'true' : 'false') + '">' +
        esc(c.name) + ' <b>' + c.count + '</b></button>';
    });
    el.chips.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escAttr(s) { return esc(s); }

  function renderGrid() {
    visible = state.works.filter(function (w) {
      return !filter || catOf(w) === filter;
    });

    el.grid.innerHTML = '';
    el.empty.hidden = visible.length !== 0;
    if (el.emptyText) {
      el.emptyText.textContent = state.works.length === 0
        ? '还没有作品。'
        : '「' + filter + '」下还没有作品，把作品归到这个分类就会出现了。';
    }

    visible.forEach(function (w, i) {
      var abs = state.works.indexOf(w) + 1;
      var card = document.createElement('article');
      card.className = 'card' + (i === 0 ? ' is-feature' : '');
      card.setAttribute('data-id', w.id);
      card.style.animationDelay = Math.min(i * 40, 320) + 'ms';

      var imgCss = [];
      if (w.focus) imgCss.push('object-position:' + w.focus);
      if (w.fit === 'contain') imgCss.push('object-fit:contain');
      var btnCss = w.bg ? 'background:' + w.bg : '';

      card.innerHTML =
        '<button class="card-img" type="button"' + (btnCss ? ' style="' + escAttr(btnCss) + '"' : '') +
          ' aria-label="查看 ' + escAttr(w.title) + '">' +
          (w.image ? '<img src="' + escAttr(w.image) + '" alt="' + escAttr(w.title) + '"' +
            (imgCss.length ? ' style="' + escAttr(imgCss.join(';')) + '"' : '') +
            ' loading="lazy" decoding="async">' : '') +
        '</button>' +
        '<div class="card-tools">' +
          '<button type="button" data-act="up" title="上移" aria-label="上移"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>' +
          '<button type="button" data-act="down" title="下移" aria-label="下移"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg></button>' +
          '<button type="button" data-act="edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24"><path d="M13.6 3.2l3.2 3.2L7 16.2l-4 1 1-4z"/></svg></button>' +
          '<button type="button" data-act="del" title="删除" aria-label="删除"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>' +
        '</div>' +
        '<div class="card-meta"><span class="num">' + pad(abs) + '</span><span class="sep"></span><span>' + esc(w.category) + '</span></div>' +
        '<h3 class="card-title">' + esc(w.title) + '</h3>' +
        (w.en ? '<p class="card-en">' + esc(w.en) + '</p>' : '');

      if (editing) {
        card.setAttribute('draggable', 'true');
        card.classList.add('draggable');
      }
      el.grid.appendChild(card);
    });

    // 首尾禁用
    if (editing && visible.length) {
      var first = el.grid.querySelector('.card');
      var last = el.grid.querySelector('.card:last-child');
      if (first) first.querySelector('[data-act=up]').disabled = true;
      if (last) last.querySelector('[data-act=down]').disabled = true;
    }
  }

  function renderAll() {
    renderSiteText();
    renderFacts();
    renderChips();
    renderGrid();
    renderCatRows();
  }

  // 分类管理弹窗里的行
  function renderCatRows() {
    if (!el.catRows) return;
    var cats = categories();
    if (!cats.length) {
      el.catRows.innerHTML = '<li class="cat-row"><span class="cat-count">暂无分类</span></li>';
      return;
    }
    el.catRows.innerHTML = cats.map(function (c, i) {
      return '<li class="cat-row" data-name="' + escAttr(c.name) + '">' +
        '<input class="cat-name-input" value="' + escAttr(c.name) + '" aria-label="分类名称">' +
        '<span class="cat-count">' + c.count + ' 件</span>' +
        '<button class="cat-act" type="button" data-cat-act="up"' + (i === 0 ? ' disabled' : '') +
          ' title="上移" aria-label="上移"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>' +
        '<button class="cat-act" type="button" data-cat-act="down"' + (i === cats.length - 1 ? ' disabled' : '') +
          ' title="下移" aria-label="下移"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg></button>' +
        '<button class="cat-act is-danger" type="button" data-cat-act="del" title="删除" aria-label="删除">' +
          '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>' +
      '</li>';
    }).join('');
  }

  // 作品编辑弹窗里的分类下拉
  function renderCatOptions(selected) {
    if (!el.fCat) return;
    var names = categories().map(function (c) { return c.name; });
    if (selected && names.indexOf(selected) < 0) names.push(selected);
    el.fCat.innerHTML = names.map(function (n) {
      return '<option value="' + escAttr(n) + '">' + esc(n) + '</option>';
    }).join('') + '<option value="__new__">＋ 新建分类…</option>';
    if (selected) el.fCat.value = selected;
  }

  /* ---------------- 编辑模式 ---------------- */
  function setEditing(on) {
    editing = !!on;
    el.body.classList.toggle('editing', editing);
    el.editbar.hidden = !editing;
    el.drop.hidden = !editing;
    el.editBadge.hidden = !editing;
    el.btnEditLabel.textContent = editing ? '完成' : '编辑';
    el.btnEdit.classList.toggle('btn-ghost', !editing);
    el.btnEdit.classList.toggle('btn-solid', editing);
    renderGrid();
    if (editing) {
      toast('编辑已开启：点作品改内容，按住图片可拖动排序');
      var anchor = document.getElementById('grid');
      if (anchor) {
        var top = anchor.getBoundingClientRect().top + window.scrollY - 140;
        if (window.scrollY < top - 40) {
          setTimeout(function () {
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          }, 60);
        }
      }
    }
  }

  /* ---------------- 提示 ---------------- */
  var toastTimer = null;
  function toast(msg, isError) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('is-error', !!isError);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, isError ? 4200 : 2600);
  }

  /* ---------------- 灯箱 ---------------- */
  function openLightbox(idx, keepHash) {
    if (idx < 0 || idx >= visible.length) return;
    lbIndex = idx;
    var w = visible[idx];
    var abs = state.works.indexOf(w) + 1;
    el.lbImg.src = w.image;
    el.lbImg.alt = w.title;
    el.lbNum.textContent = pad(abs);
    el.lbTotal.textContent = state.works.length;
    el.lbTitle.textContent = w.title;
    el.lbEn.textContent = w.en || '';
    el.lbEn.style.display = w.en ? '' : 'none';
    el.lbCat.textContent = catOf(w);
    el.lbDesc.textContent = w.desc || '';
    el.lbDesc.style.display = w.desc ? '' : 'none';
    el.lbTags.innerHTML = (w.tags || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    el.lb.hidden = false;
    el.body.classList.add('no-scroll');
    if (!keepHash && history.replaceState) history.replaceState(null, '', '#work-' + w.id);
  }
  function closeLightbox() {
    el.lb.hidden = true;
    lbIndex = -1;
    if (el.editor.hidden && el.settings.hidden) el.body.classList.remove('no-scroll');
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  }
  function stepLightbox(d) {
    if (!visible.length) return;
    openLightbox((lbIndex + d + visible.length) % visible.length);
  }

  /* ---------------- 图片处理 ---------------- */
  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function compress(file) {
    return loadImageFile(file).then(function (img) {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, MAX_IMAGE / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var cv = document.createElement('canvas');
      cv.width = cw;
      cv.height = ch;
      var ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      return cv.toDataURL('image/jpeg', JPEG_QUALITY);
    });
  }

  function readImage(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return /^image\//.test(f.type);
    });
    if (!list.length) { toast('请选择图片文件', true); return Promise.resolve([]); }
    return Promise.all(list.map(function (f) {
      return compress(f).then(function (data) {
        return { name: baseName(f), data: data };
      }).catch(function () { return null; });
    })).then(function (res) {
      return res.filter(Boolean);
    });
  }

  function baseName(file) {
    return (file.name || '作品').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '作品';
  }

  function newId() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- 作品编辑器 ---------------- */
  function openEditor(id) {
    if (id) {
      var w = state.works.filter(function (x) { return x.id === id; })[0];
      if (!w) return;
      draft = clone(w);
      draftIsNew = false;
      el.editorTitle.textContent = '编辑作品';
      el.btnDeleteWork.hidden = false;
    } else {
      draft = {
        id: newId(), title: '', en: '', category: filter || (categories()[0] || {}).name || '未分类',
        tags: [], desc: '', image: ''
      };
      draftIsNew = true;
      el.editorTitle.textContent = '添加作品';
      el.btnDeleteWork.hidden = true;
    }
    fillEditor();
    openModal(el.editor);
    setTimeout(function () { el.fTitle.focus(); }, 40);
  }

  function fillEditor() {
    el.fTitle.value = draft.title || '';
    el.fEn.value = draft.en || '';
    el.fTags.value = (draft.tags || []).join(', ');
    el.fDesc.value = draft.desc || '';
    el.fContain.checked = draft.fit === 'contain';
    renderCatOptions(draft.category);
    setEditorImage(draft.image);
  }

  function setEditorImage(src) {
    draft.image = src || '';
    if (src) {
      el.imgPreview.src = src;
      el.imgSlot.classList.add('has-image');
    } else {
      el.imgPreview.removeAttribute('src');
      el.imgSlot.classList.remove('has-image');
    }
  }

  function openModal(node) {
    node.hidden = false;
    el.body.classList.add('no-scroll');
  }
  function closeModal(node) {
    node.hidden = true;
    if (el.lb.hidden) el.body.classList.remove('no-scroll');
  }

  function submitEditor() {
    var title = el.fTitle.value.trim() || '未命名作品';
    var tags = el.fTags.value.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var cat = el.fCat.value;
    if (cat === '__new__') cat = draft.category || '';
    draft.title = title;
    draft.en = el.fEn.value.trim();
    draft.category = String(cat || '').trim() || '未分类';
    draft.tags = tags;
    draft.desc = el.fDesc.value.trim();
    if (el.fContain.checked) {
      draft.fit = 'contain';
      draft.bg = draft.bg || '#151515';
    } else {
      draft.fit = '';
      draft.bg = '';
    }

    if (!draft.image) { toast('请先选一张图片', true); return; }

    if (draftIsNew) {
      state.works.push(draft);
    } else {
      var i = state.works.findIndex(function (x) { return x.id === draft.id; });
      if (i >= 0) state.works[i] = draft;
    }
    save();
    closeModal(el.editor);
    renderAll();
    toast(draftIsNew ? '已添加「' + draft.title + '」' : '已保存');
    draft = null;
  }

  /* ---------------- 站点设置 ---------------- */
  function openSettings() {
    var s = state.site;
    $('#sBrand').value = s.brand || '';
    $('#sAuthor').value = s.author || '';
    $('#sRole').value = s.role || '';
    $('#sMeta').value = s.meta || '';
    $('#sTagline').value = s.tagline || '';
    $('#sEmail').value = s.email || '';
    $('#sIntro').value = s.intro || '';
    $('#sAbout').value = s.about || '';
    openModal(el.settings);
  }

  function submitSettings() {
    state.site.brand = $('#sBrand').value.trim() || '作品集';
    state.site.author = $('#sAuthor').value.trim();
    state.site.role = $('#sRole').value.trim();
    state.site.meta = $('#sMeta').value.trim();
    state.site.tagline = $('#sTagline').value.trim();
    state.site.email = $('#sEmail').value.trim();
    state.site.intro = $('#sIntro').value.trim();
    state.site.about = $('#sAbout').value.trim();
    save();
    closeModal(el.settings);
    renderSiteText();
    toast('站点设置已保存');
  }

  /* ---------------- 分类管理弹窗 ---------------- */
  function openCats() {
    renderCatRows();
    openModal(el.cats);
    setTimeout(function () { el.catNew.focus(); }, 60);
  }

  function addFromInput() {
    var name = el.catNew.value.trim();
    if (!name) { el.catNew.focus(); return; }
    var made = addCategory(name);
    if (made) el.catNew.value = '';
    el.catNew.focus();
  }

  /* ---------------- 排序 ---------------- */
  function moveWork(id, dir) {
    var vi = visible.findIndex(function (x) { return x.id === id; });
    if (vi < 0) return;
    var target = visible[vi + dir];
    if (!target) return;
    reorder(id, target.id, dir > 0);
  }

  function reorder(dragId, targetId, after) {
    var from = state.works.findIndex(function (x) { return x.id === dragId; });
    if (from < 0) return;
    var item = state.works.splice(from, 1)[0];
    var to = state.works.findIndex(function (x) { return x.id === targetId; });
    if (to < 0) { state.works.splice(from, 0, item); return; }
    state.works.splice(after ? to + 1 : to, 0, item);
    save();
    renderGrid();
  }

  /* ---------------- 备份 ---------------- */
  function exportJSON() {
    var data = {
      app: 'portfolio-site', version: SCHEMA, exportedAt: new Date().toISOString(),
      site: state.site, categories: catOrder(), works: state.works
    };
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'portfolio-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('已导出备份，换设备时用「导入备份」恢复');
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  function download(content, filename, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 6000);
  }

  // 把当前内容打包成一个自包含的 HTML（图片内嵌），可直接上传到任何静态托管
  function exportSite() {
    toast('正在打包成品页…');
    var works = clone(state.works);
    var site = clone(state.site);
    var cats = catOrder();
    var jobs = works.map(function (w) {
      if (!w.image || w.image.indexOf('data:') === 0) return Promise.resolve();
      return fetch(w.image)
        .then(function (r) { return r.blob(); })
        .then(blobToDataURL)
        .then(function (d) { w.image = d; })
        .catch(function () {});
    });
    Promise.all(jobs).then(function () {
      return Promise.all([
        fetch('index.html').then(function (r) { return r.text(); }),
        fetch('assets/css/style.css').then(function (r) { return r.text(); }),
        fetch('assets/js/app.js').then(function (r) { return r.text(); })
      ]);
    }).then(function (res) {
      var html = res[0], css = res[1], js = res[2];
      var seed = JSON.stringify({ site: site, categories: cats, works: works }).replace(/</g, '\\u003c');
      // 内联脚本里出现 </script 会提前截断 <script>，必须先转义
      js = js.replace(/<\/script/gi, '<\\/script');
      css = css.replace(/<\/script/gi, '<\\/script');
      html = html.replace('<link rel="stylesheet" href="assets/css/style.css">', function () {
        return '<style>\n' + css + '\n</style>';
      });
      html = html.replace('<script src="assets/js/seed.js"></script>', function () {
        return '<script>window.__PUBLISHED__=true;window.SEED=' + seed + ';</script>';
      });
      html = html.replace('<script src="assets/js/app.js"></script>', function () {
        return '<script>\n' + js + '\n</script>';
      });
      download(html, 'portfolio-site.html', 'text/html');
      toast('成品页已导出：一个 HTML 文件，直接上传即可');
    }).catch(function () {
      toast('打包失败：请用本地服务器方式打开（见 README），file:// 下浏览器不允许读取资源', true);
    });
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.works)) throw new Error('格式不对');
        if (!confirm('导入会覆盖当前所有作品（共 ' + state.works.length + ' 件），确定吗？')) return;
        state = normalize({ site: data.site, works: data.works });
        save();
        renderAll();
        toast('已导入 ' + state.works.length + ' 件作品');
      } catch (e) {
        toast('导入失败：' + e.message, true);
      }
    };
    reader.onerror = function () { toast('读取文件失败', true); };
    reader.readAsText(file);
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    // 分类筛选
    el.chips.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      filter = b.getAttribute('data-cat') || '';
      renderChips();
      renderGrid();
      window.scrollTo({ top: $('#works').offsetTop - 120, behavior: 'smooth' });
    });

    // 网格点击
    el.grid.addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        e.stopPropagation();
        var act = actBtn.getAttribute('data-act');
        if (act === 'edit') openEditor(id);
        else if (act === 'del') {
          var w = state.works.filter(function (x) { return x.id === id; })[0];
          if (w && confirm('删除「' + w.title + '」？此操作不可撤销。')) {
            state.works = state.works.filter(function (x) { return x.id !== id; });
            save();
            renderAll();
            toast('已删除');
          }
        } else if (act === 'up') moveWork(id, -1);
        else if (act === 'down') moveWork(id, 1);
        return;
      }
      var imgBtn = e.target.closest('.card-img');
      if (!imgBtn) return;
      if (editing) { openEditor(id); return; }
      var idx = visible.findIndex(function (x) { return x.id === id; });
      openLightbox(idx);
    });

    // 拖拽排序
    var dragId = null;
    el.grid.addEventListener('dragstart', function (e) {
      if (!editing) { e.preventDefault(); return; }
      var card = e.target.closest('.card');
      if (!card) return;
      dragId = card.getAttribute('data-id');
      card.classList.add('is-dragging');
      try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    });
    el.grid.addEventListener('dragend', function (e) {
      var card = e.target.closest('.card');
      if (card) card.classList.remove('is-dragging');
      $$('.card.drag-over', el.grid).forEach(function (c) { c.classList.remove('drag-over'); });
      dragId = null;
    });
    el.grid.addEventListener('dragover', function (e) {
      if (!editing || !dragId) return;
      var card = e.target.closest('.card');
      if (!card || card.getAttribute('data-id') === dragId) return;
      e.preventDefault();
      if (!card.classList.contains('drag-over')) {
        $$('.card.drag-over', el.grid).forEach(function (c) { c.classList.remove('drag-over'); });
        card.classList.add('drag-over');
      }
    });
    el.grid.addEventListener('drop', function (e) {
      if (!editing || !dragId) return;
      var card = e.target.closest('.card');
      if (!card) return;
      e.preventDefault();
      var rect = card.getBoundingClientRect();
      var after = (e.clientX - rect.left) > rect.width / 2;
      reorder(dragId, card.getAttribute('data-id'), after);
    });

    // 灯箱
    el.lbClose.addEventListener('click', closeLightbox);
    el.lbPrev.addEventListener('click', function () { stepLightbox(-1); });
    el.lbNext.addEventListener('click', function () { stepLightbox(1); });
    el.lb.addEventListener('click', function (e) {
      if (e.target === el.lb || e.target.closest('.lb-media')) closeLightbox();
    });

    // 编辑模式
    el.btnEdit.addEventListener('click', function () { setEditing(!editing); });
    $('#ebDone').addEventListener('click', function () { setEditing(false); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#ebAdd').addEventListener('click', function () { openEditor(null); });
    el.btnEmptyAdd.addEventListener('click', function () {
      if (!editing) setEditing(true);
      openEditor(null);
    });
    $('#ebSettings').addEventListener('click', openSettings);
    $('#ebCats').addEventListener('click', openCats);

    // 分类管理
    el.catAddBtn.addEventListener('click', addFromInput);
    el.catNew.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
    });
    el.catRows.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cat-act]');
      if (!btn) return;
      var row = btn.closest('.cat-row');
      if (!row) return;
      var name = row.getAttribute('data-name');
      var act = btn.getAttribute('data-cat-act');
      if (act === 'up') moveCategory(name, -1);
      else if (act === 'down') moveCategory(name, 1);
      else if (act === 'del') removeCategory(name);
    });
    el.catRows.addEventListener('change', function (e) {
      var input = e.target.closest('.cat-name-input');
      if (!input) return;
      var row = input.closest('.cat-row');
      if (!row) return;
      if (!renameCategory(row.getAttribute('data-name'), input.value)) renderCatRows();
    });
    el.catRows.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.closest('.cat-name-input')) {
        e.preventDefault();
        e.target.blur();
      }
    });

    // 作品编辑器里「新建分类…」
    el.fCat.addEventListener('change', function () {
      if (el.fCat.value !== '__new__') return;
      var prev = (draft && draft.category) || '';
      var name = window.prompt('新分类名称：');
      if (name && name.trim()) {
        var made = addCategory(name);
        renderCatOptions(made || prev);
        if (draft && made) draft.category = made;
      } else {
        renderCatOptions(prev);
      }
    });
    $('#ebExport').addEventListener('click', exportJSON);
    $('#ebPublish').addEventListener('click', exportSite);
    $('#ebPrint').addEventListener('click', printPage);
    $('#ebImport').addEventListener('click', function () { el.jsonInput.click(); });
    el.jsonInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });
    $('#ebReset').addEventListener('click', function () {
      if (!confirm('还原为最初的 15 件示例作品？你自己添加的内容会被清空。')) return;
      dbClear().then(function () {
        state = seedState();
        filter = '';
        renderAll();
        toast('已还原默认内容');
      });
    });

    // 上传
    el.btnDrop.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', function (e) {
      addFiles(e.target.files);
      e.target.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (t) {
      el.drop.addEventListener(t, function (e) {
        if (!editing) return;
        e.preventDefault(); el.drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      el.drop.addEventListener(t, function (e) { el.drop.classList.remove('is-over'); });
    });
    el.drop.addEventListener('drop', function (e) {
      if (!editing) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    // 作品编辑器
    el.editorForm.addEventListener('submit', function (e) { e.preventDefault(); submitEditor(); });
    el.btnDeleteWork.addEventListener('click', function () {
      if (!draft || draftIsNew) return;
      if (!confirm('删除「' + draft.title + '」？')) return;
      state.works = state.works.filter(function (x) { return x.id !== draft.id; });
      save();
      closeModal(el.editor);
      renderAll();
      toast('已删除');
    });
    el.btnPickImage.addEventListener('click', function (e) { e.stopPropagation(); el.imgInput.click(); });
    el.imgSlot.addEventListener('click', function () { el.imgInput.click(); });
    el.imgInput.addEventListener('change', function (e) {
      if (!e.target.files || !e.target.files[0]) return;
      readImage(e.target.files).then(function (arr) {
        if (arr[0]) { setEditorImage(arr[0].data); toast('图片已更新'); }
      });
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      el.imgSlot.addEventListener(t, function (e) { e.preventDefault(); el.imgSlot.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      el.imgSlot.addEventListener(t, function (e) { el.imgSlot.classList.remove('is-over'); });
    });
    el.imgSlot.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) {
        readImage(e.dataTransfer.files).then(function (arr) {
          if (arr[0]) { setEditorImage(arr[0].data); toast('图片已更新'); }
        });
      }
    });

    // 站点设置
    el.settingsForm.addEventListener('submit', function (e) { e.preventDefault(); submitSettings(); });

    // 关闭按钮
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        var node = document.getElementById(b.getAttribute('data-close'));
        closeModal(node);
      });
    });
    [el.editor, el.settings, el.cats].forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) closeModal(m); });
    });

    // 键盘
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el.cats.hidden) return closeModal(el.cats);
        if (!el.settings.hidden) return closeModal(el.settings);
        if (!el.editor.hidden) return closeModal(el.editor);
        if (!el.lb.hidden) return closeLightbox();
        if (editing) setEditing(false);
        return;
      }
      if (!el.lb.hidden) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
      }
    });

    // 顶栏描边
    window.addEventListener('scroll', function () {
      el.head.classList.toggle('is-stuck', window.scrollY > 8);
    }, { passive: true });

    // 深链变化（分享 /#work-w03 这类链接）
    window.addEventListener('hashchange', applyHash);

    // 快捷键：E 进入编辑
    document.addEventListener('keydown', function (e) {
      if (PUBLISHED) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if ((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey &&
          el.editor.hidden && el.settings.hidden && el.cats.hidden) {
        setEditing(!editing);
      }
    });
  }

  function addFiles(files) {
    toast('正在处理图片…');
    readImage(files).then(function (arr) {
      if (!arr.length) { toast('没有读到可用图片', true); return; }
      arr.forEach(function (item) {
        state.works.push({
          id: newId(),
          title: item.name || '未命名作品',
          en: '',
          category: filter || (categories()[0] || {}).name || '未分类',
          tags: [],
          desc: '',
          image: item.data
        });
      });
      save();
      filter = '';
      renderAll();
      toast('已添加 ' + arr.length + ' 件作品，点卡片补标题和说明');
    });
  }

  /* ---------------- 启动 ---------------- */
  function applyHash() {
    if (location.hash.indexOf('#work-') !== 0) return;
    var id = location.hash.slice(6);
    var i = visible.findIndex(function (x) { return x.id === id; });
    if (i >= 0) openLightbox(i, true);
  }

  function boot() {
    if (el.year) el.year.textContent = new Date().getFullYear();

    // 成品页：内容以文件内嵌的 seed 为准，不碰 IndexedDB，也不给编辑入口
    if (PUBLISHED) {
      state = seedState();
      document.body.classList.add('published');
      el.btnEdit.hidden = true;
      renderAll();
      bind();
      applyHash();
      return;
    }

    openDB().then(function (d) {
      db = d;
      // ?reset=1 丢掉本地改动、回到 seed（换设备/重来一遍时用）
      if (/[?&](reset|fresh)=1/.test(location.search)) {
        return dbClear().then(function () { return null; });
      }
      return dbGet(STATE_KEY);
    }).then(function (saved) {
      state = saved ? normalize(saved) : seedState();
      if (!saved) save();
      renderAll();
      bind();
      // 深链：#work-<id> 直接打开某件作品；?edit=1 进入编辑
      if (/[?&]edit=1/.test(location.search)) setEditing(true);
      applyHash();
      if (!storeOk) toast('当前环境无法本地保存，改动只在本次会话有效', true);
    }).catch(function (err) {
      state = seedState();
      storeOk = false;
      renderAll();
      bind();
      console.error(err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
