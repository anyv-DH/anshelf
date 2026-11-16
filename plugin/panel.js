/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
(function () {
    'use strict';
    var insert = document.getElementById('insert');
    var addCurrent = document.getElementById('add-current');
    var addDialog = document.getElementById('add-confirm'), confirmSave = document.getElementById('confirm-save'), confirmCancel = document.getElementById('confirm-cancel');
    var currentFile = document.getElementById('current-file'), categorySearch = document.getElementById('category-search'), importCategory = document.getElementById('import-category');
    var importOrdinary = document.getElementById('import-ordinary'), importEffect = document.getElementById('import-effect');
    var previewResolution = document.getElementById('preview-resolution'), preferExistingPreview = document.getElementById('prefer-existing-preview'), settingsError = document.getElementById('settings-error');
    var categoryOptions = document.getElementById('category-options'), resolutionOptions = document.getElementById('resolution-options'), openImportMenu = null;
    var queue, path, localURI, extension, crypto, normalizeImportOptions, api = window.__adobe_cep__;
    var settingsWindow = !!document.getElementById('settings-window'), dialogFinished = false;
    var settingsExtension = 'com.anshelf.receiver.import-settings', panelExtension = 'com.anshelf.receiver.panel';
    var settingsRequestEvent = settingsExtension + '.request', settingsResponseEvent = settingsExtension + '.response';
    var current = null, busy = false, dropping = false, connected = false, timer = null, lastCompleted = null, lastResult = null;
    var documentId = null, contextKnown = false, probing = false, probeStarted = 0, probeGeneration = 0, unloaded = false;
    var adding = false, addRequest = null, addStarted = 0, addGeneration = 0, addPhase = null;
    var confirmation = null;

    function dispatchSettings(type, sender, data) {
        api.dispatchEvent({ type: type, scope: 'APPLICATION', appId: 'FLPR', extensionId: sender, data: JSON.stringify(data) });
    }

    function settingsPayload(value) {
        // CEP 6.1+ parses JSON event data natively; older hosts return text.
        if (typeof value === 'string') {
            if (value.length > 16384) return null;
            value = JSON.parse(value);
        }
        if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 16384) return null;
        return value;
    }

    function closeConfirmation() {
        closeImportMenus(false);
        if (addDialog) addDialog.hidden = true;
        var previous = confirmation;
        confirmation = null;
        if (previous && !settingsWindow) {
            try { dispatchSettings(settingsRequestEvent, panelExtension, { action: 'close', requestId: previous.requestId }); } catch (error) { /* Closing a panel must not save a document. */ }
        }
    }

    function escaped(value) {
        return String(value || '').replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; });
    }

    function menuParts(name) {
        return name === 'category' ? { button: importCategory, menu: categoryOptions } : { button: previewResolution, menu: resolutionOptions };
    }

    function closeImportMenus(restoreFocus) {
        var previous = openImportMenu;
        ['category', 'resolution'].forEach(function (name) {
            var parts = menuParts(name);
            if (parts.menu) parts.menu.hidden = true;
            if (parts.button) parts.button.setAttribute('aria-expanded', 'false');
        });
        openImportMenu = null;
        if (restoreFocus && previous) menuParts(previous).button.focus();
    }

    function showImportMenu(name, focusOption) {
        if (!confirmation || !addDialog || addDialog.hidden) return;
        closeImportMenus(false);
        var parts = menuParts(name), button = parts.button, menu = parts.menu;
        if (!button || !menu) return;
        openImportMenu = name;
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        var rect = button.getBoundingClientRect(), below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
        var height = Math.min(180, Math.max(60, Math.max(below, above)));
        menu.style.left = rect.left + 'px'; menu.style.width = rect.width + 'px'; menu.style.maxHeight = height + 'px';
        var actualHeight = Math.min(menu.scrollHeight, height);
        menu.style.top = (below >= actualHeight || below >= above ? rect.bottom + 4 : Math.max(8, rect.top - actualHeight - 4)) + 'px';
        if (focusOption) {
            var option = menu.querySelector('[aria-selected="true"]') || menu.querySelector('[role="option"]');
            if (option) { option.focus(); option.scrollIntoView({ block: 'nearest' }); }
        }
    }

    function setResolution(value) {
        previewResolution.value = value ? String(value) : '';
        previewResolution.textContent = value ? value === 2048 ? '2K · 2048 像素' : value + ' 像素' : '默认';
        Array.prototype.forEach.call(resolutionOptions.querySelectorAll('[role="option"]'), function (option) { option.setAttribute('aria-selected', String(option.getAttribute('data-value') === previewResolution.value)); });
    }

    function categoryScope(category, byId) {
        var seen = Object.create(null), cursor = category;
        while (cursor && !seen[cursor.id]) {
            seen[cursor.id] = true;
            if (cursor.scope && cursor.scope !== 'all') return cursor.scope;
            cursor = typeof cursor.parentId === 'string' ? byId[cursor.parentId] : null;
        }
        return 'all';
    }

    function categoryLabel(category, byId) {
        var seen = Object.create(null), names = [], cursor = category;
        while (cursor && !seen[cursor.id]) {
            seen[cursor.id] = true;
            names.unshift(cursor.name);
            cursor = typeof cursor.parentId === 'string' ? byId[cursor.parentId] : null;
        }
        return names.join(' / ');
    }

    function renderImportCategories() {
        if (!confirmation || !confirmation.settings) return;
        var settings = confirmation.settings, mode = settings.mode;
        var compatible = confirmation.categoryChoices.filter(function (category) { return category.scope === 'all' || category.scope === mode; });
        if (!compatible.some(function (category) { return category.id === settings.categoryId; })) settings.categoryId = null;
        var search = String(categorySearch.value || '').trim().toLowerCase();
        var choices = compatible.filter(function (category) { return category.id === settings.categoryId || category.searchLabel.indexOf(search) >= 0; });
        choices.sort(function (a, b) { return a.label.localeCompare(b.label); });
        categoryOptions.innerHTML = '<button type="button" role="option" data-value="" aria-selected="' + String(!settings.categoryId) + '">不指定分类（已有分类保留）</button>' + choices.map(function (category) { return '<button type="button" role="option" data-value="' + escaped(category.id) + '" aria-selected="' + String(category.id === settings.categoryId) + '">' + escaped(category.label) + '</button>'; }).join('') + (search && !choices.length ? '<p class="no-options">没有匹配的分类，请试试其他名称</p>' : '');
        importCategory.value = settings.categoryId || '';
        var selected = choices.filter(function (category) { return category.id === settings.categoryId; })[0];
        importCategory.textContent = selected ? selected.label : '不指定分类（已有分类保留）';
        importOrdinary.setAttribute('aria-pressed', String(mode === 'ordinary'));
        importEffect.setAttribute('aria-pressed', String(mode === 'effect'));
    }

    function populateImportSettings(info) {
        var choices = queue.documentImportSettings(info.file, function () { return window.localStorage; });
        if (!choices || !Array.isArray(choices.categories) || !choices.defaults) throw new Error('无法读取分类设置，请先更新并打开素材管理器');
        confirmation.categories = choices.categories;
        // Resolve ancestry once for this snapshot; typing only filters cached labels.
        var byId = Object.create(null);
        choices.categories.forEach(function (category) { if (!byId[category.id]) byId[category.id] = category; });
        confirmation.categoryChoices = choices.categories.map(function (category) {
            var label = categoryLabel(category, byId);
            return { id: category.id, label: label, searchLabel: label.toLowerCase(), scope: categoryScope(category, byId) };
        });
        confirmation.settings = { mode: choices.defaults.mode === 'effect' ? 'effect' : 'ordinary', categoryId: choices.defaults.categoryId || null };
        confirmation.preferences = choices.preferences;
        currentFile.textContent = info.name + (info.file ? '' : ' · 未保存，确认后先保存');
        currentFile.title = info.file || '未保存的 AN 文档';
        categorySearch.value = '';
        setResolution(choices.defaults.previewResolution || null);
        preferExistingPreview.checked = choices.defaults.preferExistingPreview !== false;
        settingsError.hidden = true;
        renderImportCategories();
    }

    function selectedImportOptions() {
        var mode = confirmation.settings.mode, categoryId = importCategory.value || null;
        if (categoryId && !confirmation.categoryChoices.some(function (category) { return category.id === categoryId && (category.scope === 'all' || category.scope === mode); })) throw new Error('所选分类不适合当前素材类型，请重新选择');
        var resolution = previewResolution.value ? Number(previewResolution.value) : null;
        if (resolution !== null && [256, 512, 1024, 2048].indexOf(resolution) < 0) throw new Error('请选择有效的预览分辨率');
        return { mode: mode, categoryId: categoryId, previewResolution: resolution, preferExistingPreview: !!preferExistingPreview.checked };
    }

    function confirmCurrentDocument(generation, info) {
        if (!api.requestOpenExtension || !api.addEventListener || !api.dispatchEvent) throw new Error('无法打开独立导入设置，请更新插件并重新打开面板');
        confirmation = { generation: generation, documentId: info.documentId, info: info, requestId: crypto.randomBytes(16).toString('hex') };
        addPhase = 'open-settings';
        addStarted = new Date().getTime();
        try {
            api.requestOpenExtension(settingsExtension, '');
            // A previously loaded Modeless window is only activated by CEP.
            // Ask it to repeat the handshake without an idle polling timer.
            dispatchSettings(settingsRequestEvent, panelExtension, { action: 'ping' });
        }
        catch (error) { throw new Error('无法打开独立导入设置，请重新打开面板：' + String(error.message || error)); }
    }

    function settingsResponse(event) {
        if (unloaded || !adding || !confirmation || event.extensionId !== settingsExtension) return;
        try {
            var result = settingsPayload(event.data), active = confirmation;
            if (!result) return;
            if (result.action === 'ready') {
                if (addPhase !== 'open-settings') return;
                dispatchSettings(settingsRequestEvent, panelExtension, { action: 'show', requestId: active.requestId, documentId: active.documentId, info: active.info });
                return;
            }
            if (result.requestId !== active.requestId) return;
            if (result.action === 'opened') { addPhase = 'confirm'; return; }
            if (result.action === 'cancel') { finishAdd({ ok: false, cancelled: true }); return; }
            if (result.action === 'error') { finishAdd({ ok: false, error: String(result.error || '独立导入设置未能打开') }); return; }
            if (result.action !== 'confirm' || addPhase !== 'confirm') return;
            var options = normalizeImportOptions(result.options);
            if (!options || !options.mode || !Object.prototype.hasOwnProperty.call(options, 'previewResolution') || typeof options.preferExistingPreview !== 'boolean') throw new Error('导入设置不完整，请重新打开设置');
            closeConfirmation();
            saveCurrentDocument(active.generation, active.documentId, options);
        } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
    }

    function finishSettings(result) {
        if (dialogFinished) return;
        dialogFinished = true;
        var active = confirmation;
        if (active) {
            result.requestId = active.requestId;
            try { dispatchSettings(settingsResponseEvent, settingsExtension, result); } catch (error) { /* A closed parent cannot save. */ }
        }
        closeConfirmation();
        try { api.closeExtension(); } catch (error) { /* Unload cancellation is still reported above. */ }
    }

    function settingsRequest(event) {
        if (unloaded || dialogFinished || event.extensionId !== panelExtension) return;
        try {
            var request = settingsPayload(event.data);
            if (!request) return;
            if (request.action === 'ping') { dispatchSettings(settingsResponseEvent, settingsExtension, { action: 'ready' }); return; }
            if (request.action === 'close') {
                if (/^[a-f0-9]{32}$/.test(request.requestId || '') && (!confirmation || request.requestId === confirmation.requestId)) { dialogFinished = true; closeConfirmation(); api.closeExtension(); }
                return;
            }
            if (request.action !== 'show' || !/^[a-f0-9]{32}$/.test(request.requestId || '') || typeof request.documentId !== 'number' || request.documentId < 0 || Math.floor(request.documentId) !== request.documentId || !request.info || request.info.documentId !== request.documentId || typeof request.info.name !== 'string') return;
            confirmation = { requestId: request.requestId, documentId: request.documentId };
            populateImportSettings(request.info);
            addDialog.hidden = false;
            var loading = document.getElementById('settings-loading');
            if (loading) loading.hidden = true;
            confirmCancel.focus();
            dispatchSettings(settingsResponseEvent, settingsExtension, { action: 'opened', requestId: request.requestId });
        } catch (error) { finishSettings({ action: 'error', error: String(error.message || error) }); }
    }

    function setAddButton(text, state, description, disabled) {
        if (!addCurrent) return;
        addCurrent.textContent = text;
        addCurrent.title = description;
        addCurrent.setAttribute('aria-label', text + '。' + description);
        addCurrent.setAttribute('data-state', state);
        addCurrent.disabled = disabled;
    }

    function finishAdd(result) {
        closeConfirmation();
        if (addRequest) {
            try { queue.clearDocumentImport(addRequest.requestId); } catch (error) { /* Result cleanup does not undo the import. */ }
        }
        addRequest = null;
        adding = false;
        addPhase = null;
        addGeneration++;
        var description = result.cancelled ? '已取消加入，未添加或更新素材。' : result.ok ? '素材：' + (result.name || '当前文档') + '。已加入安安素材管理器；预览在后台生成，可回管理器分类。' : String(result.error || '加入未完成');
        setAddButton(result.cancelled ? '已取消' : result.ok ? '已加入 ✓' : '加入失败', result.cancelled ? 'ready' : result.ok ? 'success' : 'error', description, false);
        if (addCurrent && typeof addCurrent.focus === 'function') addCurrent.focus();
        if (!unloaded) { heartbeat(); poll(); }
    }

    function addCurrentDocument() {
        if (!addCurrent || adding || busy || !connected || unloaded) return;
        adding = true;
        addPhase = 'inspect';
        addStarted = new Date().getTime();
        var generation = ++addGeneration;
        setAddButton('正在读取…', 'busy', '正在读取当前 AN 文档，请稍候；此时尚未保存或导入。', true);
        insert.disabled = true;
        heartbeat();
        try {
            var scriptURI = localURI(path.join(extension, 'insert-whole.jsfl'));
            var code = '(function(){try{return fl.runScript(' + JSON.stringify(scriptURI) + ',"AnShelfCurrentDocumentInfoForLibrary");}catch(e){return "{\\"version\\":1,\\"ok\\":false,\\"error\\":\\"无法读取当前AN文档\\"}";}})();';
            api.evalScript(code, function (response) {
                if (unloaded || !adding || generation !== addGeneration || addPhase !== 'inspect') return;
                try {
                    if (!response || response === 'EvalScript error.') throw new Error('AN 未能读取当前文档，请关闭 AN 中的弹窗后重试，或重新打开面板');
                    var info = JSON.parse(response);
                    if (!info || info.version !== 1 || info.ok !== true) throw new Error(info && info.error || 'AN 返回的当前文档信息无效');
                    if (typeof info.documentId !== 'number' || !isFinite(info.documentId) || info.documentId < 0 || info.documentId > 9007199254740991 || Math.floor(info.documentId) !== info.documentId || typeof info.name !== 'string') throw new Error('无法确认当前 AN 文档，请重新打开面板');
                    documentId = info.documentId;
                    addPhase = 'confirm';
                    setAddButton('等待确认…', 'busy', '请确认导入设置；取消不会保存或加入。', true);
                    confirmCurrentDocument(generation, info);
                } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
            });
        } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
    }

    function saveCurrentDocument(generation, confirmedDocumentId, options) {
        if (unloaded || !adding || generation !== addGeneration) return;
        addPhase = 'save';
        setAddButton(confirmedDocumentId === null ? '等待确认…' : '正在保存…', 'busy', '保存当前 AN 文档；取消保存就取消加入。', true);
        try {
            var scriptURI = localURI(path.join(extension, 'insert-whole.jsfl'));
            var confirmed = confirmedDocumentId === null ? '' : ',' + JSON.stringify(String(confirmedDocumentId));
            var code = '(function(){try{return fl.runScript(' + JSON.stringify(scriptURI) + ',"AnShelfCurrentDocumentForLibrary"' + confirmed + ');}catch(e){return "{\\"version\\":1,\\"ok\\":false,\\"error\\":\\"无法读取当前AN文档\\"}";}})();';
            api.evalScript(code, function (response) {
                if (unloaded || !adding || generation !== addGeneration || addPhase !== 'save') return;
                try {
                    var result = JSON.parse(response);
                    if (!result || result.version !== 1 || typeof result.ok !== 'boolean') throw new Error('AN 返回的当前文档信息无效');
                    if (!result.ok) { finishAdd(result); return; }
                    addRequest = queue.requestDocumentImport(result.file, options);
                    addPhase = 'receipt';
                    // The timeout begins after the user finishes Animate's native Save dialog.
                    addStarted = new Date().getTime();
                    setAddButton('正在加入…', 'busy', '请保持安安素材管理器开启；正在加入：' + (result.name || '当前文档'), true);
                } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
            });
        } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
    }

    function checkDocumentImport() {
        if (!adding) return;
        if (addPhase === 'inspect' && new Date().getTime() - addStarted >= 10000) {
            finishAdd({ ok: false, error: 'AN 未及时响应文档读取，请关闭 AN 中的弹窗后重试；仍无响应时请重新打开面板。当前操作未保存或提交素材。' });
            return;
        }
        if (addPhase === 'open-settings' && new Date().getTime() - addStarted >= 10000) {
            finishAdd({ ok: false, error: '独立导入设置未能打开，请更新插件并重新打开面板后重试。当前操作未保存或提交素材。' });
            return;
        }
        // Native confirmation and Save As belong to the user, so never time
        // them out or repeat a save while their callback is still pending.
        if (!addRequest) return;
        try {
            var result = queue.documentImportResult(addRequest.requestId);
            if (result) { finishAdd(result); return; }
            if (new Date().getTime() - addStarted > 60000) finishAdd({ ok: false, error: '素材管理器未及时响应，请先打开最新版管理器再重试；正在处理的素材可能稍后完成。' });
        } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
    }

    function setButton(text, state, description, disabled) {
        insert.textContent = text;
        insert.title = description;
        insert.setAttribute('aria-label', text + '。' + description);
        insert.setAttribute('data-state', state);
        insert.disabled = disabled;
    }

    function showResult() {
        setButton(lastResult.text, lastResult.state, lastResult.description, true);
    }

    function assetName(request) {
        return String(request.asset.name || '未命名素材');
    }

    try {
        if (!api || !api.evalScript || !api.getSystemPath) throw new Error('CEP 环境不可用');
        var nodeRequire = window.cep_node && window.cep_node.require ? window.cep_node.require : require;
        path = nodeRequire('path');
        crypto = nodeRequire('crypto');
        extension = decodeURI(api.getSystemPath('extension').replace(/^file:\/\//, ''));
        if (extension.charAt(0) === '/' && /^[A-Za-z]:/.test(extension.substring(1))) extension = extension.substring(1);
        var receiver = nodeRequire(path.join(extension, 'queue.cjs'));
        localURI = receiver.localURI;
        normalizeImportOptions = receiver.documentImportOptions;
        var appData = nodeRequire('process').env.APPDATA;
        if (!appData) throw new Error('无法定位 Windows AppData');
        queue = new receiver.Queue(path.join(appData, 'AnShelf'));
    } catch (error) {
        if (settingsWindow) {
            var loading = document.getElementById('settings-loading');
            if (loading) loading.textContent = '设置无法打开：' + String(error.message || error) + '。请更新插件并重新打开面板。';
            return;
        }
        setButton('连接失败', 'error', String(error.message || error) + '。请检查 Animate 的 CEP 面板安装配置。', true);
        setAddButton('连接失败', 'error', String(error.message || error), true);
        return;
    }

    function heartbeat() {
        try {
            queue.heartbeat(busy || adding, documentId);
            connected = true;
            if (addCurrent) addCurrent.disabled = busy || adding;
            if (busy && current) setButton('正在粘贴…', 'busy', '正在粘贴素材：' + assetName(current), true);
            return true;
        } catch (error) {
            connected = false;
            if (addCurrent) addCurrent.disabled = true;
            setButton('连接失败', 'error', '无法写入桥接状态：' + String(error.message || error), true);
            return false;
        }
    }

    function refreshContext() {
        if (unloaded) return;
        if (adding) { checkDocumentImport(); if (adding) { heartbeat(); return; } }
        if (probing && new Date().getTime() - probeStarted < 10000) return;
        // An insertion temporarily activates its source document. Preserve the
        // target identity and publish busy until that operation has completed.
        if (busy) { heartbeat(); return; }
        probing = true;
        probeStarted = new Date().getTime();
        var generation = ++probeGeneration;
        var code = '(function(){try{var d=fl.getDocumentDOM();return d&&typeof d.id==="number"&&isFinite(d.id)&&d.id>=0&&Math.floor(d.id)===d.id?String(d.id):"null";}catch(e){return "null";}})();';
        try {
            api.evalScript(code, function (response) {
                if (generation !== probeGeneration) return;
                probing = false;
                if (unloaded) return;
                if (busy || adding) { heartbeat(); return; }
                var id = response === 'null' ? null : Number(response);
                documentId = typeof response === 'string' && /^(0|[1-9][0-9]*)$/.test(response) && id <= 9007199254740991 ? id : null;
                contextKnown = true;
                if (heartbeat()) poll();
            });
        } catch (error) {
            probing = false;
            connected = false;
            documentId = null;
            contextKnown = false;
            setButton('连接失败', 'error', '无法读取 AN 当前文档：' + String(error.message || error), true);
        }
    }

    function poll() {
        if (busy || adding || !connected) return;
        try {
            var pending = queue.pending();
            if (!pending) {
                current = null;
                if (lastResult) showResult();
                else setButton('等待素材', 'waiting', '已连接。可从安安素材管理器拖素材到此按钮直接粘贴，或在管理器点击“粘贴到舞台”。', true);
                return;
            }
            if (pending.requestId === lastCompleted) {
                current = null;
                showResult();
                return;
            }
            current = pending;
            lastCompleted = null;
            lastResult = null;
            if (pending.delivery === 'stage-drop' || pending.delivery === 'image-import') {
                if (!contextKnown) {
                    setButton('等待 AN 文档…', 'waiting', '正在确认素材接收的 AN 文档。', true);
                    return;
                }
                var now = new Date().getTime();
                var imageImport = pending.delivery === 'image-import';
                var error = pending.expiresAt <= now || pending.createdAt > now + 1000 ? (imageImport ? '图片导入请求已过期，请重新导入' : '舞台拖拽请求已过期，请重新拖入') : pending.targetDocumentId !== documentId ? '目标文档已切换或关闭，请回到原文档重试' : null;
                if (error) {
                    busy = true;
                    finish(pending, { ok: false, error: error });
                } else insertWhole();
                return;
            }
            setButton('粘贴到舞台', 'ready', '素材：' + assetName(pending) + '。粘贴到当前图层、当前播放指针位置，并居中到舞台。', false);
        } catch (error) {
            current = null;
            setButton('请求无效', 'error', '素材请求无效：' + String(error.message || error), true);
        }
    }

    function finish(request, result) {
        if (!busy || !current || current.requestId !== request.requestId || lastCompleted === request.requestId) return;
        var description = '素材：' + assetName(request) + '。';
        try { queue.complete(request, result); } catch (error) { result = { ok: false, error: '结果写入失败：' + String(error.message || error) }; }
        description += result.ok ? (request.delivery === 'image-import' ? '图片已导入当前舞台。' : '已粘贴到当前舞台。') : String(result.error || '插入未完成');
        if (result.warning) description += '\n' + result.warning;
        busy = false;
        current = null;
        lastCompleted = request.requestId;
        lastResult = { text: result.ok ? (request.delivery === 'image-import' ? '已导入 ✓' : '已粘贴 ✓') : (request.delivery === 'image-import' ? '导入失败' : '粘贴失败'), state: result.ok ? 'success' : 'error', description: description };
        showResult();
        heartbeat();
    }

    function insertWhole() {
        if (!current || busy || adding || !connected) return;
        var request = current, prepared = null;
        busy = true;
        setButton(request.delivery === 'image-import' ? '正在导入…' : '正在粘贴…', 'busy', '正在插入素材：' + assetName(request), true);
        if (!heartbeat()) { busy = false; return; }
        try {
            prepared = queue.prepare(request);
            var scriptURI = localURI(path.join(extension, 'insert-whole.jsfl'));
            var requestJSON = JSON.stringify(prepared);
            var entryPoint = prepared.asset.kind === 'image' ? 'AnShelfImportImage' : 'AnShelfInsertWhole';
            var code = '(function(){try{return fl.runScript(' + JSON.stringify(scriptURI) + ',' + JSON.stringify(entryPoint) + ',' + JSON.stringify(requestJSON) + ',' + JSON.stringify(prepared.managedRoot) + ');}catch(e){return "{\\"version\\":1,\\"ok\\":false,\\"error\\":\\"JSFL加载失败\\"}";}})();';
            api.evalScript(code, function (response) {
                var result;
                try {
                    result = JSON.parse(response);
                    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') throw new Error('无效的结果');
                } catch (error) { result = { ok: false, error: 'AN 返回了无效结果，请检查目标舞台' }; }
                finish(request, result);
            });
        } catch (error) { finish(request, { ok: false, error: String(error.message || error) }); }
    }

    function dropFailure(error) {
        dropping = false;
        setButton('拖入失败', 'error', String(error.message || error), true);
    }

    function dropTransfer(event) {
        event.preventDefault();
        event.stopPropagation();
        if (busy || adding || dropping || !connected) return;
        var files = event.dataTransfer && event.dataTransfer.files;
        if (!files || files.length !== 1 || !/^[a-zA-Z0-9-]{1,80}\.anshelf-transfer$/.test(files[0].name) || files[0].size > 4096) {
            dropFailure(new Error('请从安安素材管理器拖素材到此处；直接拖 FLA 文件不会粘贴到舞台'));
            return;
        }
        var file = files[0], reader = new FileReader();
        dropping = true;
        reader.onerror = function () { dropFailure(new Error('无法读取拖拽素材，请重新从管理器拖出')); };
        reader.onload = function () {
            dropping = false;
            if (busy || adding || !connected || unloaded) return;
            try {
                current = queue.acceptDrop(JSON.parse(reader.result), file.name);
                if (current.requestId === lastCompleted) throw new Error('此素材已处理，请重新从管理器拖出');
                lastCompleted = null;
                lastResult = null;
                insertWhole();
            } catch (error) { dropFailure(error); }
        };
        try { reader.readAsText(file, 'UTF-8'); } catch (error) { dropFailure(error); }
    }

    if (insert) insert.addEventListener('click', insertWhole);
    if (addCurrent) addCurrent.addEventListener('click', addCurrentDocument);
    if (confirmCancel) confirmCancel.addEventListener('click', function () {
        if (confirmation) finishSettings({ action: 'cancel' });
    });
    if (confirmSave) confirmSave.addEventListener('click', function () {
        if (!confirmation || unloaded || dialogFinished) return;
        var accepted = confirmation, options;
        try { options = selectedImportOptions(); }
        catch (error) { settingsError.textContent = String(error.message || error); settingsError.hidden = false; return; }
        if (typeof queue.rememberDocumentImportOptions === 'function') queue.rememberDocumentImportOptions(options, function () { return window.localStorage; });
        finishSettings({ action: 'confirm', options: options });
    });
    if (categorySearch) {
        categorySearch.addEventListener('input', function () { renderImportCategories(); showImportMenu('category', false); });
        categorySearch.addEventListener('keydown', function (event) { if (event.key === 'ArrowDown' || event.keyCode === 40) { event.preventDefault(); showImportMenu('category', true); } });
    }
    ['category', 'resolution'].forEach(function (name) {
        var parts = menuParts(name);
        if (!parts.button || !parts.menu) return;
        parts.button.addEventListener('click', function () { if (openImportMenu === name) closeImportMenus(false); else showImportMenu(name, true); });
        parts.button.addEventListener('keydown', function (event) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.keyCode === 40 || event.keyCode === 38) { event.preventDefault(); showImportMenu(name, true); }
        });
        parts.menu.addEventListener('click', function (event) {
            var option = event.target.closest('[role="option"]');
            if (!option || !parts.menu.contains(option)) return;
            var value = option.getAttribute('data-value');
            if (name === 'category') { confirmation.settings.categoryId = value || null; renderImportCategories(); }
            else setResolution(value ? Number(value) : null);
            closeImportMenus(true);
        });
        parts.menu.addEventListener('keydown', function (event) {
            var options = Array.prototype.slice.call(parts.menu.querySelectorAll('[role="option"]'));
            var index = options.indexOf(document.activeElement), target;
            if (event.key === 'ArrowDown' || event.keyCode === 40) target = (index + 1) % options.length;
            else if (event.key === 'ArrowUp' || event.keyCode === 38) target = (index + options.length - 1) % options.length;
            else if (event.key === 'Home' || event.keyCode === 36) target = 0;
            else if (event.key === 'End' || event.keyCode === 35) target = options.length - 1;
            if (target !== undefined && options[target]) { event.preventDefault(); options[target].focus(); options[target].scrollIntoView({ block: 'nearest' }); }
        });
    });
    [importOrdinary, importEffect].forEach(function (button) {
        if (button) button.addEventListener('click', function () {
            if (!confirmation || !confirmation.settings) return;
            closeImportMenus(false);
            confirmation.settings.mode = button === importEffect ? 'effect' : 'ordinary';
            var preference = confirmation.preferences && confirmation.preferences[confirmation.settings.mode];
            if (preference) { setResolution(preference.previewResolution); preferExistingPreview.checked = preference.preferExistingPreview !== false; }
            renderImportCategories();
        });
    });
    if (document.addEventListener) document.addEventListener('keydown', function (event) {
        if (!confirmation || !addDialog || addDialog.hidden) return;
        if (openImportMenu && (event.key === 'Escape' || event.keyCode === 27)) { event.preventDefault(); closeImportMenus(true); return; }
        if (openImportMenu && (event.key === 'Tab' || event.keyCode === 9)) closeImportMenus(true);
        if (event.key === 'Escape' || event.keyCode === 27) { event.preventDefault(); finishSettings({ action: 'cancel' }); }
        else if (event.key === 'Tab' || event.keyCode === 9) {
            var controls = Array.prototype.filter.call(addDialog.querySelectorAll('button:not([disabled]), input:not([disabled])'), function (control) { return control.getClientRects().length > 0; });
            var first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    if (document.addEventListener) document.addEventListener('click', function (event) {
        if (!openImportMenu) return;
        var parts = menuParts(openImportMenu);
        if (!parts.menu.contains(event.target) && !parts.button.contains(event.target) && event.target !== categorySearch) {
            var focusTarget = event.target.closest('button, a[href], input, select, textarea, [tabindex]');
            closeImportMenus(!focusTarget);
        }
    });
    if (document.body && document.body.addEventListener) {
        document.body.addEventListener('dragover', function (event) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = busy || adding || dropping ? 'none' : 'copy';
        });
        document.body.addEventListener('drop', dropTransfer);
    }
    if (settingsWindow) {
        if (!api.addEventListener || !api.dispatchEvent || !api.closeExtension) return;
        api.addEventListener(settingsRequestEvent, settingsRequest);
        window.addEventListener('beforeunload', function () { finishSettings({ action: 'cancel' }); });
        window.addEventListener('unload', function () {
            finishSettings({ action: 'cancel' }); unloaded = true;
            if (api.removeEventListener) api.removeEventListener(settingsRequestEvent, settingsRequest);
        });
        dispatchSettings(settingsResponseEvent, settingsExtension, { action: 'ready' });
        return;
    }
    if (api.addEventListener) api.addEventListener(settingsResponseEvent, settingsResponse);
    setButton('正在连接…', 'waiting', '正在连接 AN 当前文档。', true);
    heartbeat();
    poll();
    refreshContext();
    timer = setInterval(refreshContext, 1000);
    window.addEventListener('unload', function () {
        unloaded = true; addGeneration++; closeConfirmation();
        if (timer) clearInterval(timer);
        if (api.removeEventListener) api.removeEventListener(settingsResponseEvent, settingsResponse);
    });
}());
